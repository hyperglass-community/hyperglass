"""Count requests against shared per-client and global quotas.

A feature (such as `query`, `dns` or `aspath`) passes its name, its limits and its
window to `take_quota`, and decides itself how to answer a request over the quota and
what to do when Redis is unreachable.
"""

# Standard Library
import typing as t
import asyncio
import hashlib
import ipaddress

# Project
from hyperglass.log import log
from hyperglass.state import use_state
from hyperglass.exceptions.public import RateLimited

# Local
from .metrics import REDIS_UNAVAILABLE
from .client_address import client_address

if t.TYPE_CHECKING:
    # Third Party
    from litestar import Request
    from litestar.connection import ASGIConnection

    # Project
    from hyperglass.models.config.web import ClientIP
    from hyperglass.models.config.params import Params

__all__ = ("client_identity", "query_limit_guard", "quota_identity", "take_quota")

# One atomic fixed window shared by every worker. Check the global budget before
# allocating a client key, so rotating source addresses cannot create unlimited keys.
# A request over either budget changes nothing. A counter gets its expiry when it is
# created, and later requests don't extend it. A counter found without an expiry
# (`TTL` -1, e.g. one written by hand) gets one, so it can't block a client forever.
_RATE = """
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
local client = tonumber(redis.call('GET', KEYS[2]) or '0')
if total >= tonumber(ARGV[1]) or client >= tonumber(ARGV[2]) then return 0 end
for _, key in ipairs(KEYS) do
    redis.call('INCR', key)
    if redis.call('TTL', key) == -1 then redis.call('EXPIRE', key, ARGV[3]) end
end
return 1
"""


def quota_identity(address: str) -> str:
    """Return the identity a client's quota is counted against.

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


def client_identity(connection: "ASGIConnection", client_ip: t.Optional["ClientIP"] = None) -> str:
    """Return the hashed identity of the connection's client.

    The client is identified by `client_address` (forwarding headers only from trusted
    proxies, `client_ip` or `web.client_ip`) and `quota_identity` (IPv6 per /64). The
    result is a SHA-256 hex digest, safe to use in Redis keys and logs.
    """
    address = quota_identity(client_address(connection, client_ip))
    return hashlib.sha256(address.encode()).hexdigest()


def _key(feature: str, suffix: str) -> str:
    return f"{use_state('redis').key('quota')}:{feature}:{suffix}"


async def take_quota(
    connection: "ASGIConnection",
    feature: str,
    *,
    client_limit: int,
    global_limit: int,
    window: int,
    client_ip: t.Optional["ClientIP"] = None,
) -> bool:
    """Count one request from the connection's client against a feature's quotas.

    Returns `False`, without counting the request, when the client or all clients
    together have used the feature's quota for the current window of `window` seconds.
    The client is identified by `client_identity`; pass `client_ip` when the caller
    already has `web.client_ip`, to save reading the configuration again.

    Redis errors are raised, so each feature decides whether an unreachable Redis lets
    its requests through or refuses them.
    """
    identity = client_identity(connection, client_ip)
    instance = use_state("redis").instance
    allowed = await asyncio.to_thread(
        instance.eval,
        _RATE,
        2,
        _key(feature, "global"),
        _key(feature, f"client:{identity}"),
        global_limit,
        client_limit,
        window,
    )
    return bool(allowed)


async def query_limit_guard(request: "Request", params: "Params") -> None:
    """Apply `query_limit` to a validated query, before its cache lookup.

    Raises `RateLimited` (HTTP 429) over the limit. When Redis is unreachable the query
    is let through: it then fails with the 503 every request gets during an outage, and
    the limit must not turn that outage into 429s.
    """
    limit = params.query_limit
    if not limit.enable:
        return
    try:
        allowed = await take_quota(
            request,
            "query",
            client_limit=limit.client_limit,
            global_limit=limit.global_limit,
            window=limit.window,
            client_ip=params.web.client_ip,
        )
    except REDIS_UNAVAILABLE as error:
        log.bind(error=str(error)).warning("Query rate limit skipped: Redis is unreachable")
        return
    if not allowed:
        raise RateLimited(retry_after=limit.window)
