"""Store share snapshots of cached query results in Redis (#559).

Shares live under `hyperglass.share:`, outside the `hyperglass.state.` namespace that
`HyperglassState.clear()` deletes on every start, so they survive a restart:

- `hyperglass.share:<id>`: a hash with `snapshot`, the snapshot as JSON (`Snapshot`),
  and `token`, the SHA-256 of its delete token. It expires `share.timeout` seconds after
  it is created; reading it does not extend that.
- `hyperglass.share:index`: a sorted set of share ids, scored by expiry time. It bounds
  the number of live shares (`share.max_entries`).

A share is created by one Lua script, from a cached query result that the share route
has copied. The script checks that the cached result is still the one copied, that the
store is not full (it never deletes other shares to make room), and records the share
id on the cached result, so the same client sharing the same result again gets the same
id for as long as that result is cached.

The functions here are synchronous Redis calls: the API runs them in a thread.
"""

# Standard Library
import hmac
import json
import pickle
import typing as t
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

# Third Party
from pydantic import ValidationError

# Project
from hyperglass.log import log
from hyperglass.models.share import SNAPSHOT_VERSION, Snapshot

if t.TYPE_CHECKING:
    # Third Party
    from redis import Redis

    # Project
    from hyperglass.state.redis import RedisManager
    from hyperglass.models.directive import Directive
    from hyperglass.models.config.devices import Devices

__all__ = (
    "PREFIX",
    "INDEX",
    "Created",
    "CachedResult",
    "clear_shares",
    "create_share",
    "delete_share",
    "delete_share_with_token",
    "list_shares",
    "new_delete_token",
    "new_share_id",
    "read_cached_result",
    "read_share",
    "share_directive",
    "token_hash",
    "valid_share_id",
)

PREFIX = "hyperglass.share:"
INDEX = f"{PREFIX}index"

# Fields of a cached query result that a share copies. `query`, `labels`, `format`,
# `runtime` and `result_id` are written with the result by `POST /api/query`.
_RESULT_FIELDS = (
    "output",
    "timestamp",
    "enrichment_status",
    "query",
    "labels",
    "format",
    "runtime",
    "result_id",
)

# Compared with the token of a missing share; no token hashes to it.
_NO_TOKEN = b"-" * 64

# Return codes of `_CREATE`.
_CHANGED, _CREATED, _REUSED, _FULL, _TAKEN = range(5)

# KEYS: cached result, new share, index.
# ARGV: result id as stored (pickled), field naming this client's share of this
# result on the cached result, new share id, snapshot JSON, token hash, expiry time
# (Unix seconds), now (Unix seconds), max entries, share key prefix.
#
# A cached result that was replaced or has expired since it was copied is not shared
# (and `HSET` must not recreate it without an expiry). A share this client already made
# of this result is returned, with a new token hash. Expired ids are removed from the
# index before it is counted. A full index is checked for ids whose share Redis deleted
# before it expired (a `volatile-*` eviction policy); if it is still full, the share is
# refused. Nothing that exists is deleted to make room.
_CREATE = """
if redis.call('HGET', KEYS[1], 'result_id') ~= ARGV[1] then return {0} end
local existing = redis.call('HGET', KEYS[1], ARGV[2])
if existing then
    local key = ARGV[9] .. existing
    if redis.call('EXISTS', key) == 1 then
        redis.call('HSET', key, 'token', ARGV[5])
        return {2, existing, redis.call('HGET', key, 'snapshot')}
    end
end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[7])
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[8]) then
    for _, id in ipairs(redis.call('ZRANGE', KEYS[3], 0, -1)) do
        if redis.call('EXISTS', ARGV[9] .. id) == 0 then redis.call('ZREM', KEYS[3], id) end
    end
    if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[8]) then return {3} end
end
if redis.call('EXISTS', KEYS[2]) == 1 then return {4} end
redis.call('HSET', KEYS[2], 'snapshot', ARGV[4], 'token', ARGV[5])
redis.call('EXPIREAT', KEYS[2], ARGV[6])
redis.call('ZADD', KEYS[3], ARGV[6], ARGV[3])
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
return {1}
"""

# KEYS: share, index. ARGV: token hash the caller checked, share id.
# Deletes the share only if its token hash is still the one checked.
_DELETE = """
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
return 1
"""


def _key(share_id: str) -> str:
    # The callers check the id first; this is the last line before a key is named.
    if not valid_share_id(share_id):
        raise ValueError("Not a share id")
    return f"{PREFIX}{share_id}"


def new_share_id() -> str:
    """Return a new share id: 16 random bytes, as hex."""
    return secrets.token_hex(16)


def new_delete_token() -> str:
    """Return a new delete token: 32 random bytes, URL-safe base64."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """Return the SHA-256 hex digest stored in place of a delete token."""
    return hashlib.sha256(token.encode()).hexdigest()


def valid_share_id(share_id: str) -> bool:
    """Whether `share_id` has the form of a share id."""
    return len(share_id) == 32 and all(char in "0123456789abcdef" for char in share_id)


class CachedResult(t.NamedTuple):
    """A cached query result, as `POST /api/query` wrote it."""

    # Redis key of the cached result.
    key: str
    # `result_id` as stored, to check the result is unchanged when the share is created.
    stored_id: bytes
    # Redis server time, in whole seconds.
    now: int
    values: t.Dict[str, t.Any]


def read_cached_result(cache: "RedisManager", query_id: str) -> t.Optional[CachedResult]:
    """Read the fields of a cached query result that a share needs.

    Returns `None` when the result is not cached, or was cached without the fields a
    share copies.
    """
    key = cache.key(query_id)
    with cache.instance.pipeline(transaction=True) as pipeline:
        stored, (seconds, _) = pipeline.hmget(key, _RESULT_FIELDS).time().execute()
    raw = dict(zip(_RESULT_FIELDS, stored))
    if any(value is None for name, value in raw.items() if name != "enrichment_status"):
        return None
    # Written by `POST /api/query` through `RedisManager`, which pickles every value.
    values = {
        name: None if value is None else pickle.loads(value)  # noqa: S301
        for name, value in raw.items()
    }
    return CachedResult(key=key, stored_id=stored[-1], now=int(seconds), values=values)


def share_directive(devices: "Devices", location: str, query_type: str) -> t.Optional["Directive"]:
    """Return the directive a shared result came from, if it is still configured."""
    for device in devices:
        if device.id == location:
            for directive in device.directives:
                if directive.id == query_type:
                    return directive
    return None


def build_snapshot(result: CachedResult, timeout: int) -> Snapshot:
    """Build a snapshot from a cached result's allowlisted fields."""
    values = result.values
    query = values["query"]
    labels = values["labels"]
    created = datetime.fromtimestamp(result.now, UTC)
    return Snapshot(
        version=SNAPSHOT_VERSION,
        created_at=created,
        expires_at=created + timedelta(seconds=timeout),
        results=[
            {
                "query": {
                    "location": query["location"],
                    "query_type": query["query_type"],
                    "query_type_name": query["query_type_name"],
                    "target": query["target"],
                    "variables": dict(query["variables"]),
                },
                "labels": {"location": labels["location"], "query_type": labels["query_type"]},
                "output": values["output"],
                "format": values["format"],
                "timestamp": str(values["timestamp"]),
                "runtime": int(values["runtime"]),
            }
        ],
    )


class Created(t.NamedTuple):
    """Outcome of `create_share`."""

    # `changed`, `created`, `reused` or `full`.
    status: str
    share_id: t.Optional[str] = None
    expires_at: t.Optional[datetime] = None


def create_share(
    instance: "Redis",
    result: CachedResult,
    *,
    snapshot_json: str,
    expires_at: datetime,
    client: str,
    token: str,
    max_entries: int,
    retry: bool = True,
) -> Created:
    """Store a snapshot of `result`, or return the share `client` already made of it.

    `client` is the client's hashed identity. Only its share of this result is looked up
    on the cached result; the identity is not stored in the share.
    """
    share_id = new_share_id()
    reply = instance.eval(
        _CREATE,
        3,
        result.key,
        _key(share_id),
        INDEX,
        result.stored_id,
        f"share:{result.values['result_id']}:{client}",
        share_id,
        snapshot_json,
        token_hash(token),
        int(expires_at.timestamp()),
        result.now,
        max_entries,
        PREFIX,
    )
    code = int(reply[0])
    if code == _CREATED:
        return Created("created", share_id, expires_at)
    if code == _REUSED:
        existing = reply[1].decode()
        try:
            snapshot = Snapshot.model_validate_json(reply[2] or b"")
        except ValidationError:
            if not retry:
                raise
            # A share that can't be read can't be served either: replace it.
            log.bind(share=existing).error("Stored share is invalid and is replaced")
            delete_share(instance, existing)
            return create_share(
                instance,
                result,
                snapshot_json=snapshot_json,
                expires_at=expires_at,
                client=client,
                token=token,
                max_entries=max_entries,
                retry=False,
            )
        return Created("reused", existing, snapshot.expires_at)
    if code == _FULL:
        return Created("full")
    if code == _TAKEN:
        # 128 random bits: a collision means the random source is broken.
        raise RuntimeError("New share id already exists")
    return Created("changed")


class StoredShare(t.NamedTuple):
    """Outcome of `read_share`."""

    # `found`, `not_found`, `invalid` or `unsupported`.
    status: str
    snapshot: t.Optional[Snapshot] = None


def _parse(fields: t.Dict[bytes, bytes]) -> StoredShare:
    if not fields:
        return StoredShare("not_found")
    token = fields.get(b"token", b"")
    if len(token) != 64 or any(char not in b"0123456789abcdef" for char in token):
        return StoredShare("invalid")
    try:
        data = json.loads(fields.get(b"snapshot", b""))
    except ValueError:
        return StoredShare("invalid")
    if not isinstance(data, dict):
        return StoredShare("invalid")
    version = data.get("version")
    if type(version) is not int:
        return StoredShare("invalid")
    if version != SNAPSHOT_VERSION:
        return StoredShare("unsupported")
    try:
        return StoredShare("found", Snapshot.model_validate(data))
    except ValidationError:
        return StoredShare("invalid")


def read_share(instance: "Redis", share_id: str) -> StoredShare:
    """Read and validate a stored share. Only a valid snapshot of this version is returned."""
    if not valid_share_id(share_id):
        return StoredShare("not_found")
    stored = _parse(instance.hgetall(_key(share_id)))
    if stored.status == "invalid":
        log.bind(share=share_id).error("Stored share is invalid and is not served")
    elif stored.status == "unsupported":
        log.bind(share=share_id).warning("Stored share has an unsupported version")
    return stored


def delete_share_with_token(instance: "Redis", share_id: str, token: str) -> bool:
    """Delete a share if `token` is its delete token."""
    if not valid_share_id(share_id):
        return False
    stored = instance.hget(_key(share_id), "token")
    # Compare in constant time, also for a missing share, so neither the answer nor its
    # timing tells a wrong token from a missing share.
    matches = hmac.compare_digest(stored or _NO_TOKEN, token_hash(token).encode())
    if stored is None or not matches:
        return False
    # Delete only if the token hash is still the one compared: a later share request
    # by its creator replaces it.
    return bool(instance.eval(_DELETE, 2, _key(share_id), INDEX, stored, share_id))


def delete_share(instance: "Redis", share_id: str) -> bool:
    """Delete a share whatever its token; for the operator."""
    # Only a share: never the index or another key under the prefix.
    if not valid_share_id(share_id):
        return False
    with instance.pipeline(transaction=True) as pipeline:
        deleted, _ = pipeline.delete(_key(share_id)).zrem(INDEX, share_id).execute()
    return bool(deleted)


def list_shares(instance: "Redis") -> t.List[t.Tuple[str, StoredShare]]:
    """List live shares, oldest expiry first, after removing expired ids from the index."""
    now, _ = instance.time()
    instance.zremrangebyscore(INDEX, "-inf", now)
    shares = []
    for member in instance.zrange(INDEX, 0, -1):
        share_id = member.decode(errors="replace")
        if valid_share_id(share_id):
            shares.append((share_id, _parse(instance.hgetall(_key(share_id)))))
        else:
            shares.append((share_id, StoredShare("invalid")))
    return shares


def clear_shares(instance: "Redis") -> int:
    """Delete every key under `hyperglass.share:`, the index included; return how many."""
    deleted = 0
    batch = []
    for key in instance.scan_iter(match=f"{PREFIX}*", count=500):
        batch.append(key)
        if len(batch) == 500:
            deleted += instance.delete(*batch)
            batch = []
    if batch:
        deleted += instance.delete(*batch)
    return deleted
