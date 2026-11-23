"""Share snapshots of cached query results (#559).

Registered only when `share.enable` is set. `POST /api/share` copies a cached query
result into a snapshot that lives until `share.timeout`, `GET /api/share/{id}` reads it,
and `DELETE /api/share/{id}` deletes it with the delete token returned when it was
created. Storage is in `hyperglass.share`.
"""

# Standard Library
import typing as t
import asyncio

# Third Party
from litestar import Request, Response, get, post, delete
from pydantic import TypeAdapter, AwareDatetime
from litestar.di import Provide
from redis.exceptions import OutOfMemoryError
from litestar.handlers import BaseRouteHandler
from litestar.connection import ASGIConnection
from litestar.exceptions import HTTPException
from litestar.datastructures import MutableScopeHeaders

# Project
from hyperglass import share as storage
from hyperglass.log import log
from hyperglass.state import HyperglassState
from hyperglass.models.share import Snapshot, ShareRequest
from hyperglass.exceptions.public import (
    RateLimited,
    SharePending,
    ShareNotFound,
    ShareTooLarge,
    ShareNotAllowed,
    ShareUnavailable,
    ShareUnsupported,
    ShareResultExpired,
)

# Local
from .quota import take_quota, client_identity
from .state import get_state
from .metrics import record_share

if t.TYPE_CHECKING:
    # Third Party
    from litestar.types import Send, Scope, ASGIApp, Message, Receive

    # Project
    from hyperglass.models.config.quota import RateQuota
    from hyperglass.models.config.params import Params
    from hyperglass.models.config.devices import Devices

__all__ = ("DELETE_HEADER", "share_create", "share_delete", "share_read")

# Request header carrying the delete token. Never a URL parameter: URLs end up in
# browser history, proxy logs and `Referer` headers.
DELETE_HEADER = "X-Delete-Token"

# Longest delete token accepted; real ones are 43 characters.
_MAX_TOKEN = 128

_NO_STORE = {"Cache-Control": "no-store"}
_READ_HEADERS = {**_NO_STORE, "X-Robots-Tag": "noindex"}


def no_store(app: "ASGIApp") -> "ASGIApp":
    """Mark every response of a share route `Cache-Control: no-store`.

    Route middleware also sees the responses of the exception handlers, so errors such
    as 400, 413, 429 and 503 are covered too. A create response carries a delete token,
    and any answer can change with the next request.
    """

    async def middleware(scope: "Scope", receive: "Receive", send: "Send") -> None:
        async def send_no_store(message: "Message") -> None:
            if message["type"] == "http.response.start":
                MutableScopeHeaders.from_message(message)["Cache-Control"] = "no-store"
            await send(message)

        await app(scope, receive, send_no_store)

    return middleware


def require_json(connection: ASGIConnection, _: BaseRouteHandler) -> None:
    """Refuse a share request that is not JSON, before its body is read or counted.

    A page on another site can make a visitor's browser send a form or `text/plain` post
    without a CORS preflight, which would use up that visitor's share quota. JSON needs a
    preflight, which the CORS settings refuse for other origins.
    """
    content_type = connection.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "application/json":
        # The status's own phrase: a protocol error the UI never causes, not a message
        # for visitors, so it doesn't come from `messages`.
        raise HTTPException(status_code=415)


_TIME = TypeAdapter(AwareDatetime)


async def _take_quota(
    request: Request, params: "Params", feature: str, quota: "RateQuota", operation: str
) -> None:
    """Count the request against `quota`, or answer 429.

    An unreachable Redis is raised: a share request can't be answered without Redis, so
    the request gets the 503 of an outage. A full Redis (`maxmemory` with `noeviction`)
    refuses the counter's write: a new share then gets 503, while reading or deleting an
    existing share, which writes nothing else, goes on uncounted.
    """
    try:
        allowed = await take_quota(
            request,
            feature,
            client_limit=quota.client_limit,
            global_limit=quota.global_limit,
            window=quota.window,
            client_ip=params.web.client_ip,
        )
    except OutOfMemoryError:
        log.bind(operation=operation).warning("Share quota not counted: Redis is full")
        if operation == "create":
            record_share(operation, "full")
            raise ShareUnavailable() from None
        return
    if not allowed:
        record_share(operation, "rate_limited")
        raise RateLimited(retry_after=quota.window)


def _check_shareable(result: t.Optional[storage.CachedResult], devices: "Devices") -> None:
    """Raise the error for a cached result that can't be shared."""
    if result is None:
        record_share("create", "not_found")
        raise ShareResultExpired()
    if result.values["enrichment_status"] == "pending":
        record_share("create", "pending")
        raise SharePending()
    query = result.values["query"]
    directive = storage.share_directive(devices, query["location"], query["query_type"])
    if directive is None or not directive.retain:
        record_share("create", "not_allowed")
        raise ShareNotAllowed()


def _visible(snapshot: Snapshot, devices: "Devices") -> bool:
    """Whether every result's directive is still configured, with `retain` set."""
    for result in snapshot.results:
        directive = storage.share_directive(devices, result.query.location, result.query.query_type)
        if directive is None or not directive.retain:
            return False
    return True


@post(
    "/api/share",
    dependencies={"_state": Provide(get_state)},
    guards=[require_json],
    middleware=[no_store],
    request_max_body_size=1024,
    include_in_schema=False,
)
async def share_create(_state: HyperglassState, request: Request, data: ShareRequest) -> Response:
    """Copy a cached query result into a share, or return this client's existing one."""
    params = _state.params
    config = params.share
    # Before anything is read, so a refused request costs one script.
    await _take_quota(request, params, "share", config.quota, "create")
    client = client_identity(request, params.web.client_ip)

    result = await asyncio.to_thread(storage.read_cached_result, _state.redis, data.query_id)
    _check_shareable(result, _state.devices)

    snapshot = storage.build_snapshot(result, config.timeout)
    snapshot_json = snapshot.model_dump_json(by_alias=True)
    if len(snapshot_json.encode()) > config.max_size:
        record_share("create", "too_large")
        raise ShareTooLarge()

    token = storage.new_delete_token()
    try:
        created = await asyncio.to_thread(
            storage.create_share,
            _state.redis.instance,
            result,
            snapshot_json=snapshot_json,
            expires_at=snapshot.expires_at,
            client=client,
            token=token,
            max_entries=config.max_entries,
        )
    except OutOfMemoryError:
        # Redis at `maxmemory` with `noeviction` refuses the write: the store is full.
        created = storage.Created("full")
    if created.status == "changed":
        # Replaced or expired after it was read.
        record_share("create", "not_found")
        raise ShareResultExpired()
    if created.status == "full":
        record_share("create", "full")
        log.bind(client=client, max_entries=config.max_entries).warning(
            "Share refused: the share store is full"
        )
        raise ShareUnavailable()

    record_share("create", created.status)
    log.bind(client=client, share=created.share_id).info(f"Share {created.status}")
    return Response(
        {
            "id": created.share_id,
            "expiresAt": _TIME.dump_python(created.expires_at, mode="json"),
            "deleteToken": token,
        },
        status_code=201 if created.status == "created" else 200,
        headers=_NO_STORE,
    )


@get(
    "/api/share/{share_id:str}",
    dependencies={"_state": Provide(get_state)},
    middleware=[no_store],
    include_in_schema=False,
)
async def share_read(_state: HyperglassState, request: Request, share_id: str) -> Response:
    """Return a share, if it is valid and its directives still allow it."""
    params = _state.params
    await _take_quota(request, params, "share_read", params.share.read_quota, "read")

    stored = storage.StoredShare("not_found")
    if storage.valid_share_id(share_id):
        stored = await asyncio.to_thread(storage.read_share, _state.redis.instance, share_id)
    if stored.status == "unsupported":
        record_share("read", "unsupported")
        raise ShareUnsupported()
    if stored.status != "found":
        record_share("read", stored.status)
        raise ShareNotFound()
    if not _visible(stored.snapshot, _state.devices):
        # Kept in Redis: setting `retain: true` again serves it until it expires.
        record_share("read", "hidden")
        raise ShareNotFound()

    record_share("read", "found")
    return Response(
        {"id": share_id, **stored.snapshot.model_dump(mode="json", by_alias=True)},
        headers=_READ_HEADERS,
    )


@delete(
    "/api/share/{share_id:str}",
    dependencies={"_state": Provide(get_state)},
    middleware=[no_store],
    include_in_schema=False,
)
async def share_delete(_state: HyperglassState, request: Request, share_id: str) -> None:
    """Delete a share with its delete token, sent in the `X-Delete-Token` header.

    Counted against `share.read_quota`. A wrong or missing token gets the same 404 as a
    missing share, so the answer doesn't tell whether an id exists. The token is never
    logged.
    """
    params = _state.params
    # Counted with reads: each request reads Redis, and a miss is logged.
    await _take_quota(request, params, "share_read", params.share.read_quota, "delete")
    client = client_identity(request, params.web.client_ip)
    token = request.headers.get(DELETE_HEADER, "")
    deleted = False
    if token and len(token) <= _MAX_TOKEN and storage.valid_share_id(share_id):
        deleted = await asyncio.to_thread(
            storage.delete_share_with_token, _state.redis.instance, share_id, token
        )
    if not deleted:
        record_share("delete", "not_found")
        # The id only if it has the form of one: the path is the client's.
        known = share_id if storage.valid_share_id(share_id) else None
        log.bind(client=client, share=known).info("Share not deleted: no match")
        raise ShareNotFound()
    record_share("delete", "deleted")
    log.bind(client=client, share=share_id).info("Share deleted")
