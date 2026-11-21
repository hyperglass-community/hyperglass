"""API Routes."""

# Standard Library
import re
import json
import time
import asyncio
import ipaddress
import typing as t
from uuid import uuid4
from datetime import UTC, datetime

# Third Party
from redis import Redis
from litestar import Request, Response, get, post
from litestar.di import Provide
from litestar.background_tasks import BackgroundTask
from netmiko.exceptions import ReadTimeout

# Project
from hyperglass.log import log
from hyperglass.state import HyperglassState, use_state
from hyperglass.exceptions import HyperglassError
from hyperglass.exceptions.public import DeviceTimeout
from hyperglass.execution.drivers.ssh_netmiko import delay_factor_override, device_delay_factor
from hyperglass.models.api import Query
from hyperglass.models.data import OutputDataModel
from hyperglass.util.typing import is_type
from hyperglass.execution.main import execute
from hyperglass.models.api.response import QueryResponse
from hyperglass.models.config.params import Params, APIParams
from hyperglass.models.config.devices import Devices, APIDevice

# Local
from .state import get_state, get_params, get_devices
from .tasks import enrich_query_output, send_webhook
from .client_address import client_address
from .metrics import (
    QUERY_METRICS_OPT,
    set_query_labels,
    record_query_cache,
    record_query_success,
    record_query_duration,
)
from .middleware import skip_state_recovery
from .fake_output import fake_output
from .refresh import ForcedRefresh
from .auxiliary import ASPathRequest, lookup_guard, resolve_public_dns, enrich_public_asns

# Not user-configurable: an internal bound so an unreachable Redis reports
# unhealthy promptly instead of waiting on the OS TCP connect timeout. It stays
# well under the `hyperglass healthcheck` and container HEALTHCHECK timeouts.
HEALTH_REDIS_TIMEOUT = 3

# Not user-configurable: `/api/health` is unauthenticated, so its checks run at
# most once per interval in each worker. Concurrent requests wait for the check
# in progress, and later requests within the interval get its result.
HEALTH_CACHE_SECONDS = 1.0

__all__ = (
    "device",
    "devices",
    "queries",
    "info",
    "health",
    "query",
    "aspath_enrich",
    "query_enrichment",
    "dns",
    "myip",
)


async def _execute_query(data: "Query") -> t.Any:
    """Keep both device attempts inside one deadline, before the browser timeout."""
    deadline = asyncio.timeout(use_state("params").request_timeout - 1)
    try:
        async with deadline:
            return await _execute_with_retry(data, deadline)
    except TimeoutError as error:
        if not deadline.expired():
            raise
        raise DeviceTimeout(error=error, device=data.device) from error


async def _execute_with_retry(data: "Query", deadline: asyncio.Timeout) -> t.Any:
    """Retry one MikroTik BGP read fault, never a completed zero-route result."""
    try:
        return await execute(data)
    except DeviceTimeout as error:
        directive = getattr(data, "directive", None)
        if not (
            data.device.platform in ("mikrotik_routeros", "mikrotik_switchos")
            and getattr(directive, "_hyperglass_builtin", False)
            and getattr(directive, "query_kind", None)
            in ("bgp_route", "bgp_aspath", "bgp_community")
            and isinstance(error.__cause__, ReadTimeout)
        ):
            raise
        # A new SSH session needs useful time to connect and read a response.
        # Leave the final second for the existing timeout response instead.
        if deadline.when() - asyncio.get_running_loop().time() < 1:
            raise

    factor = max(3, device_delay_factor(data.device) * 2)
    token = delay_factor_override.set(factor)
    try:
        log.bind(device=data.device.name, delay_factor=factor).warning(
            "Retrying MikroTik BGP query after an incomplete transport read"
        )
        return await execute(data)
    finally:
        delay_factor_override.reset(token)


@post("/api/aspath/enrich", guards=[lookup_guard], request_max_body_size=8192)
async def aspath_enrich(data: ASPathRequest) -> dict:
    """Enrich a bounded list of validated ASNs when explicitly enabled."""
    return await enrich_public_asns(data.as_path)


@get("/api/dns", guards=[lookup_guard], include_in_schema=False)
async def dns(name: str, type: str = "A") -> dict:
    """Resolve public hostnames through the fixed public DNS resolver."""
    return await resolve_public_dns(name, type)


@get("/api/myip", include_in_schema=False)
async def myip(request: Request, family: int = 4) -> dict:
    """Return the requesting client's address, for the My IP button in `server` mode."""
    try:
        address = ipaddress.ip_address(client_address(request))
    except ValueError:
        return {"ip": None}
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if not address.is_global or address.is_multicast or address.is_reserved:
        return {"ip": None}
    return {"ip": str(address) if address.version == family else None}


@get("/api/query/{query_id:str}/enrichment")
async def query_enrichment(query_id: str) -> dict:
    """Return the current output and enrichment status for a cached query."""
    if not re.fullmatch(r"hyperglass\.query\.[0-9a-f]{64}", query_id):
        return {"status": "not_found"}
    from hyperglass.state import use_state

    cache = use_state("redis")
    output = cache.get_map(query_id, "output")
    if output is None:
        return {"status": "not_found"}

    return {
        "status": cache.get_map(query_id, "enrichment_status") or "complete",
        "output": output,
    }


@get("/api/devices/{id:str}", dependencies={"devices": Provide(get_devices)})
async def device(devices: Devices, id: str) -> APIDevice:
    """Retrieve a device by ID."""
    return devices[id].export_api()


@get("/api/devices", dependencies={"devices": Provide(get_devices)})
async def devices(devices: Devices) -> t.List[APIDevice]:
    """Retrieve all devices."""
    return devices.export_api()


@get("/api/queries", dependencies={"devices": Provide(get_devices)})
async def queries(devices: Devices) -> t.List[str]:
    """Retrieve all directive names."""
    return devices.directive_names()


@get("/api/info", dependencies={"params": Provide(get_params)})
async def info(params: Params) -> APIParams:
    """Retrieve looking glass parameters."""
    return params.export_api()


# One client per DSN, reused by every probe: a new connection per request would
# let a flood of health checks open connections to Redis.
_health_redis: t.Dict[str, Redis] = {}


def ping_redis(dsn: str) -> None:
    """Ping Redis over a dedicated, short-timeout connection.

    The shared connection pool has no socket timeouts, so a ping through it can
    hang for as long as the operating system waits on an unreachable host.
    """
    client = _health_redis.get(dsn)
    if client is None:
        client = _health_redis[dsn] = Redis.from_url(
            dsn,
            socket_connect_timeout=HEALTH_REDIS_TIMEOUT,
            socket_timeout=HEALTH_REDIS_TIMEOUT,
        )
    client.ping()


async def run_health_checks(state: HyperglassState) -> t.Dict[str, str]:
    """Check Redis, configuration state and the UI build."""
    checks = {}

    try:
        # In a thread, so a slow Redis does not block the worker's event loop.
        await asyncio.to_thread(ping_redis, str(state.settings.redis_dsn))
        checks["redis"] = "ok"
    except Exception as error:  # noqa: BLE001 - any failure means unhealthy
        log.bind(check="redis", error=str(error)).error("Health check failed")
        checks["redis"] = "error"

    if checks["redis"] == "ok":
        try:
            # Recovers configuration lost from Redis, as other requests do. State
            # that cannot be recovered means queries are answered with 503.
            await state.ensure_ready()
            checks["state"] = "ok"
        except Exception as error:  # noqa: BLE001 - any failure means unhealthy
            log.bind(check="state", error=str(error)).error("Health check failed")
            checks["state"] = "error"
    else:
        # State lives in Redis, so it cannot be read or recovered without it.
        checks["state"] = "error"

    if state.settings.disable_ui:
        checks["ui"] = "disabled"
    elif (state.settings.static_path / "ui" / "index.html").exists():
        checks["ui"] = "ok"
    else:
        log.bind(check="ui").error("Health check failed: the UI is not built")
        checks["ui"] = "error"

    return checks


class SharedHealthCheck:
    """Share one run of the health checks between requests in a worker.

    A run in progress is shared by every request that arrives during it, and a
    finished run is reused for `HEALTH_CACHE_SECONDS`. A run belongs to the event
    loop that started it, so a new loop (a new test client) starts its own.
    """

    def __init__(self) -> None:
        """Start with no run."""
        self.task: t.Optional["asyncio.Task[t.Dict[str, str]]"] = None
        self.finished_at = 0.0

    def _reusable(self, loop: asyncio.AbstractEventLoop) -> bool:
        task = self.task
        if task is None or task.get_loop() is not loop:
            return False
        if not task.done():
            return True
        return time.monotonic() - self.finished_at < HEALTH_CACHE_SECONDS

    def _finished(self, _: "asyncio.Task[t.Dict[str, str]]") -> None:
        self.finished_at = time.monotonic()

    async def checks(self, state: HyperglassState) -> t.Dict[str, str]:
        """Return the current checks, running them only when no run can be reused."""
        loop = asyncio.get_running_loop()
        if not self._reusable(loop):
            self.task = loop.create_task(run_health_checks(state))
            self.task.add_done_callback(self._finished)
        # A client that disconnects cancels its own wait, not the shared run.
        return dict(await asyncio.shield(self.task))

    def reset(self) -> None:
        """Forget the last run."""
        self.task = None
        self.finished_at = 0.0


shared_health_check = SharedHealthCheck()


# Replaces the app-wide `recover_state` hook. That hook reads Redis through the
# shared pool, which has no timeouts, so an unreachable Redis would hang the
# check before it runs. The checks probe Redis first, then recover state.
@get("/api/health", before_request=skip_state_recovery, include_in_schema=False)
async def health() -> Response:
    """Report whether hyperglass can serve queries.

    Responds 200 when every check passes, else 503. Failure details are logged
    rather than returned, as this endpoint is unauthenticated.
    """
    checks = await shared_health_check.checks(use_state())
    healthy = all(value != "error" for value in checks.values())
    return Response(
        {"status": "ok" if healthy else "error", "checks": checks},
        status_code=200 if healthy else 503,
    )


@post(
    "/api/query",
    dependencies={"_state": Provide(get_state)},
    opt={QUERY_METRICS_OPT: True},
)
async def query(_state: HyperglassState, request: Request, data: Query) -> QueryResponse:
    """Ingest request data pass it to the backend application to perform the query."""

    timestamp = datetime.now(UTC)

    # Initialize cache
    cache = _state.redis

    # Use hashed `data` string as key for for k/v cache store so
    # each command output value is unique.
    cache_key = f"hyperglass.query.{data.digest()}"

    _log = log.bind(query=data.summary())
    set_query_labels(request, data)

    _log.info("Starting query execution")

    cache_response = cache.get_map(cache_key, "output")
    cached_enrichment_status = cache.get_map(cache_key, "enrichment_status")
    if (
        cache_response
        and cached_enrichment_status is None
        and _state.params.structured.is_async_enrichment_enabled(cache_response)
    ):
        _log.bind(cache_key=cache_key).debug(
            "Discarding legacy cache entry without enrichment state"
        )
        cache.delete(cache_key)
        cache_response = None

    # A forced query runs again only when no other request's forced run of it holds the
    # lease and no cooldown is running; otherwise it is answered from the cache.
    refresh = ForcedRefresh(cache, cache_key, _state.params)
    cache_response = refresh.check(cache_response, force=data.force)

    json_output = False
    cached = False
    runtime = 65535
    enrichment_status = "complete"
    enrichment_output = None
    enrichment_generation = None

    if cache_response:
        _log.bind(cache_key=cache_key).debug("Cache hit")
        record_query_cache("hit")

        # If a cached response exists, reset the expiration time.
        cache.expire(cache_key, expire_in=_state.params.cache.timeout)

        cached = True
        runtime = 0
        timestamp = cache.get_map(cache_key, "timestamp")
        enrichment_status = cached_enrichment_status or "complete"

    elif not cache_response:
        _log.bind(cache_key=cache_key).debug("Cache miss")
        # A forced run skips a cached result; it is not a miss.
        record_query_cache("bypass" if refresh.forced else "miss")

        timestamp = data.timestamp

        starttime = time.time()

        with refresh.run():
            if _state.params.fake_output:
                # Return fake, static data for development purposes, if enabled.
                output = await fake_output(
                    query_type=data.query_type,
                    structured=data.device.structured_output or False,
                )
            else:
                # Both attempts share the configured request deadline.
                output = await _execute_query(data)

        endtime = time.time()
        elapsedtime = round(endtime - starttime, 4)
        _log.debug("Runtime: {!s} seconds", elapsedtime)

        if output is None:
            raise HyperglassError(message=_state.params.messages.general, alert="danger")

        record_query_duration(request, elapsedtime)

        json_output = is_type(output, OutputDataModel)

        if json_output:
            # Export structured output as JSON string to guarantee value
            # is serializable, then convert it back to a dict.
            as_json = output.export_json()
            raw_output = json.loads(as_json)
        else:
            raw_output = str(output)

        if _state.params.structured.is_async_enrichment_enabled(output):
            enrichment_status = "pending"
            enrichment_output = output
            enrichment_generation = uuid4().hex

        with cache.pipeline() as pipeline:
            refresh.record(pipeline)
            pipeline.set_map_item(cache_key, "output", raw_output)
            pipeline.set_map_item(cache_key, "timestamp", timestamp)
            pipeline.set_map_item(cache_key, "enrichment_status", enrichment_status)
            if enrichment_generation is not None:
                pipeline.set_map_item(cache_key, "enrichment_generation", enrichment_generation)
            pipeline.expire(cache_key, expire_in=_state.params.cache.timeout)

        _log.bind(cache_timeout=_state.params.cache.timeout).debug("Response cached")

        runtime = int(round(elapsedtime, 0))

    # If it does, return the cached entry
    cache_response = cache.get_map(cache_key, "output")

    json_output = is_type(cache_response, t.Dict)
    response_format = "text/plain"

    if json_output:
        response_format = "application/json"
    _log.info("Execution completed")

    response = {
        "output": cache_response,
        "id": cache_key,
        "cached": cached,
        "runtime": runtime,
        "timestamp": timestamp,
        "format": response_format,
        "enrichment": enrichment_status,
        "refresh_in": refresh.refresh_in(),
        "random": data.random(),
        "level": "success",
        "keywords": [],
    }

    # Last, after everything that can fail: `refresh_in` reads Redis, and a query
    # that fails here is counted as an error instead.
    record_query_success(request)

    return Response(
        response,
        background=BackgroundTask(
            _run_query_background_tasks,
            enrichment_output=enrichment_output,
            enrichment_generation=enrichment_generation,
            cache=cache,
            cache_key=cache_key,
            params=_state.params,
            data=data,
            request=request,
            timestamp=timestamp,
        ),
    )


async def _run_query_background_tasks(
    enrichment_output: t.Any,
    enrichment_generation: t.Optional[str],
    cache: t.Any,
    cache_key: str,
    params: Params,
    data: Query,
    request: Request,
    timestamp: datetime,
) -> None:
    """Run optional enrichment and webhook work after sending the response."""
    if enrichment_output is not None and enrichment_generation is not None:
        await enrich_query_output(
            enrichment_output, cache, cache_key, enrichment_generation,
            hostnames_only=params.structured.ip_enrichment.mode != "async",
        )
    await send_webhook(params=params, data=data, request=request, timestamp=timestamp)
