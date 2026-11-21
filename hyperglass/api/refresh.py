"""Bound forced refreshes of cached query results.

A query sent with `force` skips its cached result and runs on the device again. The
flag is unauthenticated, so when `cache.refresh.enable` is set the server bounds it per
cache key: a forced query runs only when the cached result is at least
`cache.refresh.min_interval` seconds old and no other forced run of it is in progress
or cooling down, across all workers.
"""

# Standard Library
import math
import time
import typing as t
from uuid import uuid4
from contextlib import contextmanager

# Project
from hyperglass.log import log

if t.TYPE_CHECKING:
    # Project
    from hyperglass.state.redis import RedisManager
    from hyperglass.models.config.cache import Cache

# Lease value while no forced run holds it, only the cooldown after one.
COOLDOWN = "cooldown"

# Turn this request's lease into the cooldown that follows its run. A lease that
# expired and was taken by another request is left alone.
_COOL_DOWN = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
end
return 0
"""


def refresh_in(executed_at: t.Optional[float], interval: int) -> int:
    """Return the whole seconds until a result run at `executed_at` may be refreshed.

    A result with no execution time (written before this field existed) may be
    refreshed now.
    """
    if executed_at is None:
        return 0
    return max(0, math.ceil(executed_at + interval - time.time()))


class ForcedRefresh:
    """Track one request's forced refresh of a cached query result."""

    def __init__(self, cache: "RedisManager", cache_key: str, config: "Cache", ttl: int) -> None:
        """Start with no lease and no wait.

        `ttl` bounds how long a forced run holds the lease, so a worker that dies
        mid-query does not block refreshes of that query for longer.
        """
        self.cache = cache
        self.cache_key = cache_key
        self.lease_key = cache.key(f"{cache_key}.refresh")
        self.enabled = config.refresh.enable
        self.interval = config.refresh.min_interval
        self.ttl = max(ttl, 1)
        self.token: t.Optional[str] = None
        # Whether this request replaces the cached result.
        self.forced = False
        self.wait = 0

    def check(self, cached_output: t.Any, *, force: bool) -> t.Any:
        """Return the cached output to answer with, or `None` to run the query.

        A forced query for a cached result runs only when refresh is enabled, the
        result is at least `interval` seconds old and this request takes the lease.
        Otherwise the request is answered from the cache.
        """
        if not (self.enabled and force and cached_output):
            return cached_output
        self.wait = refresh_in(self.cache.get_map(self.cache_key, "executed_at"), self.interval)
        if self.wait > 0:
            return cached_output
        token = uuid4().hex
        if not self.cache.instance.set(self.lease_key, token, nx=True, ex=self.ttl):
            self.wait = self._lease_wait()
            return cached_output
        self.token = token
        self.forced = True
        log.bind(cache_key=self.cache_key).debug("Forced refresh")
        return None

    def _lease_wait(self) -> int:
        """Return the whole seconds until the lease held by another request ends.

        A lease held by a run in progress becomes a cooldown of `interval` when the
        run finishes, so that wait is the time left on the run plus `interval`.
        """
        value = self.cache.instance.get(self.lease_key)
        remaining = max(0, math.ceil(self.cache.instance.pttl(self.lease_key) / 1000))
        if value is None or value in (COOLDOWN, COOLDOWN.encode()):
            return remaining
        return remaining + self.interval

    def clear(self, pipeline: "RedisManager") -> None:
        """Delete the result being replaced, so none of its fields outlive it."""
        if self.forced:
            pipeline.delete(self.cache_key)

    @contextmanager
    def run(self) -> t.Iterator[None]:
        """Run the query; a forced run, successful or not, then starts a cooldown.

        The lease becomes a cooldown of `interval` as soon as the device answers or
        fails. Errors are not cached, so without the cooldown a device that keeps
        failing could be forced again at once. The cooldown also covers the moment
        before the new result is written.
        """
        try:
            yield
        finally:
            if self.token is not None:
                self.cache.instance.eval(
                    _COOL_DOWN, 1, self.lease_key, self.token, COOLDOWN, self.interval
                )
                self.token = None

    def refresh_in(self) -> t.Optional[int]:
        """Return the whole seconds until a forced query can run, `None` if disabled."""
        if not self.enabled:
            return None
        executed_at = self.cache.get_map(self.cache_key, "executed_at")
        # Includes this request's own cooldown, and any forced run of the same query
        # by another request.
        return max(self.wait, self._lease_wait(), refresh_in(executed_at, self.interval))
