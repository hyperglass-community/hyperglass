"""Bound optional public lookups with shared quotas, leases and caches."""

# Standard Library
import json
import asyncio
import hashlib
import ipaddress
import re
import typing as t
from uuid import uuid4
from contextlib import asynccontextmanager

# Third Party
import httpx
from redis.exceptions import RedisError
from litestar.connection import ASGIConnection
from litestar.handlers.base import BaseRouteHandler
from litestar.exceptions import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Project
from hyperglass.state import use_state

# Local
from .client_address import client_address

if t.TYPE_CHECKING:
    # Project
    from hyperglass.models.config.web import ServerLookups

_HOSTNAME = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")
_LOCAL_SUFFIXES = ("localhost", "local", "internal", "lan", "home.arpa", "onion")

# One atomic fixed window shared by every worker. Check the global budget before
# allocating a client key, so rotating source addresses cannot create unlimited keys.
_RATE = """
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
local client = tonumber(redis.call('GET', KEYS[2]) or '0')
if total >= tonumber(ARGV[1]) or client >= tonumber(ARGV[2]) then return 0 end
for _, key in ipairs(KEYS) do
    if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, 60) end
end
return 1
"""
_ACQUIRE = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) + tonumber(clock[2]) / 1000000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"""


class ASPathRequest(BaseModel):
    """Accept a small list of valid, unambiguous 32-bit ASNs."""

    model_config = ConfigDict(extra="forbid")
    as_path: t.List[str] = Field(min_length=1, max_length=64)

    @field_validator("as_path", mode="before")
    @classmethod
    def validate_asns(cls, value: t.Any) -> t.List[str]:
        """Bound input before iteration, then normalize and deduplicate ASNs."""
        if not isinstance(value, list) or not 1 <= len(value) <= 64:
            raise ValueError("Supply between 1 and 64 ASNs")
        result = []
        for asn in value:
            if type(asn) not in (int, str) or not re.fullmatch(r"[0-9]{1,10}", str(asn)):
                raise ValueError("ASN must be an integer or decimal string")
            if not 1 <= int(asn) <= 4294967295:
                raise ValueError("ASN must be between 1 and 4294967295")
            result.append(str(int(asn)))
        return list(dict.fromkeys(result))


async def _redis(command: str, *args: t.Any, **kwargs: t.Any) -> t.Any:
    """Run shared storage operations outside the request event loop; fail closed."""
    try:
        instance = use_state("redis").instance
        return await asyncio.to_thread(getattr(instance, command), *args, **kwargs)
    except RedisError as error:
        raise HTTPException(status_code=503, detail="Lookup service unavailable") from error


def _key(suffix: str) -> str:
    return use_state("redis").key("auxiliary") + ":" + suffix


def _lookups() -> "ServerLookups":
    return use_state("params").web.server_lookups


def quota_identity(address: str) -> str:
    """Return the identity a client's lookup quota is counted against.

    An IPv6 host usually controls a whole /64, so counting each address separately would
    let one host multiply its quota, and use up the global budget, by rotating source
    addresses. IPv4 clients, and IPv4 addresses carried in IPv6, count per address.
    Anything that is not an address (such as `anonymous`) is used as it is.
    """
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return address
    if isinstance(parsed, ipaddress.IPv6Address):
        if parsed.ipv4_mapped is not None:
            return str(parsed.ipv4_mapped)
        return str(ipaddress.IPv6Network((parsed, 64), strict=False))
    return str(parsed)


async def lookup_guard(connection: ASGIConnection, handler: BaseRouteHandler) -> None:
    """Enforce runtime switches and shared per-client/global request quotas."""
    kind = "dns" if handler.fn.__name__ == "dns" else "aspath"
    web = use_state("params").web
    enabled = web.dns_provider.name == "server" if kind == "dns" else web.aspath_enrichment
    if not enabled:
        raise HTTPException(status_code=404, detail="Not found")
    identity = hashlib.sha256(quota_identity(client_address(connection)).encode()).hexdigest()
    quota = web.server_lookups.dns if kind == "dns" else web.server_lookups.aspath
    allowed = await _redis(
        "eval",
        _RATE,
        2,
        _key(f"{kind}:global"),
        _key(f"{kind}:client:{identity}"),
        quota.global_limit,
        quota.client_limit,
    )
    if not allowed:
        raise HTTPException(
            status_code=429, detail="Lookup rate limit exceeded", headers={"Retry-After": "60"}
        )


@asynccontextmanager
async def _outbound_slot() -> t.AsyncIterator[None]:
    """Lease one outbound slot across workers, expiring leases after a worker crash."""
    token = uuid4().hex
    key = _key("outbound")
    lookups = _lookups()
    if not await _redis(
        "eval", _ACQUIRE, 1, key, lookups.max_concurrent, lookups.timeout + 5, token
    ):
        raise HTTPException(status_code=503, detail="Lookup service busy")
    try:
        yield
    finally:
        await _redis("zrem", key, token)


async def _cached(key: str) -> t.Any:
    value = await _redis("get", _key(key))
    return json.loads(value) if value is not None else None


async def _cache(key: str, value: t.Any, ttl: int) -> None:
    await _redis("set", _key(key), json.dumps(value), ex=ttl)


async def _dns_query(name: str, record_type: str) -> dict:
    """Query the configured resolver without system DNS, environment proxies or redirects."""
    lookups = _lookups()
    async with httpx.AsyncClient(
        trust_env=False, follow_redirects=False, timeout=lookups.timeout
    ) as client:
        async with client.stream(
            "GET",
            str(lookups.dns.resolver),
            params={"name": name + ".", "type": record_type},
            headers={"Accept": "application/dns-json"},
        ) as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 16384:
                    raise ValueError("DNS response too large")
    return json.loads(data)


def _public_address(value: str, version: int) -> t.Optional[str]:
    if "%" in value:
        return None
    address = ipaddress.ip_address(value)
    checked = address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) else None
    checked = checked or address
    if (
        address.version != version
        or not checked.is_global
        or checked.is_multicast
        or checked.is_reserved
    ):
        return None
    # Reject IPv6 transition mechanisms that can encode a non-public IPv4 target.
    if isinstance(address, ipaddress.IPv6Address) and (
        address.sixtofour is not None
        or address.teredo is not None
        or address in ipaddress.ip_network("64:ff9b::/96")
    ):
        return None
    return str(address)


async def resolve_public_dns(name: str, record_type: str) -> dict:
    """Return only public A/AAAA answers, with a bounded shared cache."""
    name = name.lower().rstrip(".")
    record_type = record_type.upper()
    code = {"A": 1, "AAAA": 28}.get(record_type, 0)
    result = {"Status": 1, "Question": [{"name": name, "type": code}], "Answer": []}
    if (
        not code
        or not _HOSTNAME.fullmatch(name)
        or any(name == suffix or name.endswith("." + suffix) for suffix in _LOCAL_SUFFIXES)
    ):
        return result
    key = f"dns:cache:{record_type}:{name}"
    cached = await _cached(key)
    if cached is not None:
        return cached
    async with _outbound_slot():
        try:
            response = await asyncio.wait_for(_dns_query(name, record_type), _lookups().timeout)
            status = response.get("Status")
            if type(status) is not int or status not in (0, 2, 3):
                raise ValueError("Invalid DNS status")
            result["Status"] = status
            addresses = []
            ttl = 60
            for record in response.get("Answer", []):
                if record.get("type") == code:
                    ttl = min(ttl, max(0, int(record.get("TTL", 60))))
                    address = _public_address(record["data"], 4 if code == 1 else 6)
                    if address is None:
                        # Reject the whole answer instead of disclosing a partial private result.
                        return {**result, "Status": 3, "Answer": []}
                    addresses.append(address)
            if status == 0:
                result["Answer"] = [
                    {"name": name, "type": code, "TTL": ttl, "data": address}
                    for address in dict.fromkeys(addresses)
                ]
        except (
            httpx.HTTPError,
            TimeoutError,
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
            OverflowError,
        ):
            return {**result, "Status": 2, "Answer": []}
    cache_ttl = ttl if result["Answer"] else 15
    if cache_ttl:
        await _cache(key, result, cache_ttl)
    return result


async def _asn_query(asns: t.List[str]) -> dict:
    """Perform one cancellable, size-bounded WHOIS request to the configured server."""
    config = use_state("params").structured.ip_enrichment
    reader, writer = await asyncio.open_connection(config.whois_host, config.whois_port)
    try:
        writer.write(("begin\n" + "\n".join(f"AS{asn}" for asn in asns) + "\nend\n").encode())
        await writer.drain()
        data = bytearray()
        while chunk := await reader.read(4096):
            data.extend(chunk)
            if len(data) > 65536:
                raise ValueError("WHOIS response too large")
        results = {asn: {"name": f"AS{asn}", "country": ""} for asn in asns}
        for line in data.decode("utf-8", errors="replace").splitlines():
            columns = [column.strip() for column in line.split("|")]
            if len(columns) >= 4 and columns[0] in results:
                results[columns[0]] = {"name": columns[-1][:256], "country": columns[3][:2]}
        return results
    finally:
        writer.close()


async def enrich_public_asns(asns: t.List[str]) -> dict:
    """Reuse shared ASN results and bound all outbound work."""
    results = {}
    missing = []
    for asn in asns:
        cached = await _cached(f"aspath:cache:{asn}")
        if cached is None:
            missing.append(asn)
        else:
            results[asn] = cached
    if missing:
        async with _outbound_slot():
            try:
                fetched = await asyncio.wait_for(_asn_query(missing), _lookups().timeout)
            except (OSError, TimeoutError, ValueError) as error:
                raise HTTPException(status_code=503, detail="Enrichment lookup failed") from error
        for asn, value in fetched.items():
            await _cache(f"aspath:cache:{asn}", value, 3600)
        results.update(fetched)
    return {"success": True, "asn_organizations": results}
