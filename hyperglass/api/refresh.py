"""Bound forced refreshes of cached query results.

A query sent with `force` skips its cached result and runs on the device again. The
flag is unauthenticated, so when `cache.refresh.enable` is set the server bounds it per
cache key with one Redis key next to the cached result, `<cache key>.refresh`:

- Every run of the query, forced or not, sets it to a cooldown that expires after
  `cache.refresh.min_interval` seconds, unless another request's forced run holds it.
- A forced query takes it with `SET NX` before running, so at most one forced run of
  a query starts per interval, across all workers, and none during a cooldown.
- When a forced run ends, successful or not, it becomes a cooldown again.

The lease covers the request, not the device session. A Netmiko (SSH or telnet)
session runs in an executor thread that the request timeout cannot stop, so a session
that outlives the timeout can still be open when the next forced run starts.

Only Redis expiry times are compared, never the clocks of the workers.
"""

# Standard Library
import math
import typing as t
from uuid import uuid4
from contextlib import contextmanager

# Third Party
from redis.exceptions import RedisError

# Project
from hyperglass.log import log

if t.TYPE_CHECKING:
    # Project
    from hyperglass.state.redis import RedisManager
    from hyperglass.models.config.params import Params

# Value of the key during a cooldown. During a forced run it holds the run's token.
COOLDOWN = "cooldown"

# Seconds a forced run's lease outlives the request's own deadline. `_execute_query`
# stops waiting for the device at `request_timeout - 1`; the margin keeps the lease
# from expiring, and a second forced run from starting, while a late request is still
# writing its result. It does not cover the device session: a Netmiko session runs in
# an executor thread that keeps going after the request stops waiting, so it can
# overlap the next forced run, which can start once the cooldown ends.
LEASE_MARGIN = 5

# Turn this request's lease into a cooldown. Also start one if the lease expired, so a
# run that outlived its lease still gets a cooldown; a lease or cooldown that another
# request set since is left alone.
_COOL_DOWN = """
local value = redis.call('GET', KEYS[1])
if value == ARGV[1] or value == false then
    return redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
end
return 0
"""

# Start or restart the cooldown after a run that wrote its result: over no key, a
# cooldown or this request's own lease, never over another request's forced run.
_RECORD = """
local value = redis.call('GET', KEYS[1])
if value == false or value == ARGV[1] or value == ARGV[2] then
    return redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
end
return 0
"""


class ForcedRefresh:
    """Track one request's forced refresh of a cached query result."""

    def __init__(self, cache: "RedisManager", cache_key: str, params: "Params") -> None:
        """Start with no lease.

        A forced run holds the lease for `request_timeout` plus `LEASE_MARGIN`, so a
        worker that dies mid-query does not block refreshes of that query for longer.
        """
        self.cache = cache
        self.cache_key = cache_key
        self.lease_key = cache.key(f"{cache_key}.refresh")
        self.enabled = params.cache.refresh.enable
        self.interval = params.cache.refresh.min_interval
        self.ttl = max(params.request_timeout, 1) + LEASE_MARGIN
        # This request's lease while its forced run is in progress.
        self.token: t.Optional[str] = None
        # This request's lease token, kept after the run; empty if it took none.
        self.own_token = ""
        # Whether this request replaces the cached result.
        self.forced = False

    def check(self, cached_output: t.Any, *, force: bool) -> t.Any:
        """Return the cached output to answer with, or `None` to run the query.

        A forced query for a cached result runs only when refresh is enabled and this
        request takes the lease, which fails during a cooldown or another forced run.
        Otherwise the request is answered from the cache.
        """
        if not (self.enabled and force and cached_output):
            return cached_output
        token = uuid4().hex
        if not self.cache.instance.set(self.lease_key, token, nx=True, ex=self.ttl):
            return cached_output
        self.token = self.own_token = token
        self.forced = True
        log.bind(cache_key=self.cache_key).debug("Forced refresh")
        return None

    @contextmanager
    def run(self) -> t.Iterator[None]:
        """Run the query; a forced run, successful or not, then starts a cooldown.

        Errors are not cached, so without the cooldown a device that keeps failing
        could be forced again at once. The cooldown also covers the moment before the
        new result is written.
        """
        try:
            yield
        finally:
            if self.token is not None:
                try:
                    self.cache.instance.eval(
                        _COOL_DOWN, 1, self.lease_key, self.token, COOLDOWN, self.interval
                    )
                except RedisError as error:
                    # Keep the device's result or error. The lease still expires.
                    log.bind(cache_key=self.cache_key, error=str(error)).error(
                        "Failed to start the forced refresh cooldown"
                    )
                self.token = None

    def record(self, pipeline: "RedisManager") -> None:
        """Add this run to the pipeline that writes its result.

        A forced run deletes the result it replaces first, so none of its fields
        outlive it. Every run starts the cooldown in the same transaction, unless
        another request's forced run holds the key: its own cooldown follows that run.
        """
        if self.forced:
            pipeline.delete(self.cache_key)
        if self.enabled:
            pipeline.instance.eval(
                _RECORD, 1, self.lease_key, COOLDOWN, self.own_token, self.interval
            )

    def refresh_in(self) -> t.Optional[int]:
        """Return the whole seconds until a forced query can run, `None` if disabled.

        During another request's forced run this is `interval`: the run starts a
        cooldown of that length when it ends, and a request sent earlier gets the
        cached result and a new value.
        """
        if not self.enabled:
            return None
        with self.cache.instance.pipeline() as pipeline:
            value, remaining = pipeline.get(self.lease_key).pttl(self.lease_key).execute()
        if value is None:
            return 0
        if value not in (COOLDOWN, COOLDOWN.encode()):
            return self.interval
        return min(self.interval, max(0, math.ceil(remaining / 1000)))
