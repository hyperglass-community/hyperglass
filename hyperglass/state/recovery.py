"""Recover Redis-backed state that is lost while hyperglass is running.

All runtime configuration (`params`, `directives`, `devices`, `ui_params`) is written to
Redis exactly once, by `hyperglass.main.run` at startup. Redis is intentionally
ephemeral - the reference deployment runs it with no RDB and no AOF - so anything that
empties the store leaves a running hyperglass with no state and no way to get it back:
every state-touching request raises `StateError` until the process is restarted. A
replaced Redis container does exactly this, and `docker compose up -d` will replace
Redis without touching hyperglass.

This module repopulates the store in place instead. One process does the work, holding a
Redis lock so multiple uvicorn workers do not each re-read and re-validate the
configuration. The rest do not wait for the winner: they fail fast, and the request
hook turns that into a 503, so a rebuild that is slow or failing never ties up the
thread pool that also runs Redis and device calls.

Every request checks state first, so the check itself must be cheap. Once state has
been found complete, `ensure_ready` trusts that for `READY_INTERVAL` without touching
Redis or the thread pool, and the checks that do run are shared by every request in the
worker that arrives while one is in flight. A flood of requests therefore costs at most
one thread-pool job per interval per worker while state is present (#532).
"""

# Standard Library
import time
import typing as t
import asyncio
from uuid import uuid4

# Project
from hyperglass.log import log

if t.TYPE_CHECKING:
    # Local
    from .redis import RedisManager

__all__ = ("ensure_ready", "mark_stale", "rebuild_state")

# Keys that must all be present for state to be usable.
REQUIRED_KEYS = (
    "params",
    "directives",
    "devices",
    "ui_params",
    "generation",
    "plugins.input",
    "plugins.output",
    "plugins.ready",
)

# Lock key, held for the duration of a rebuild by the process performing it.
LOCK_KEY = ("rebuild", "lock")

# Expiry of the lock, so a process that dies mid-rebuild cannot block recovery forever.
LOCK_TIMEOUT = 60

# How long to fail fast after a failed rebuild, or after finding a rebuild already running
# elsewhere. Without this, a configuration that cannot be loaded would be re-read and
# re-validated on every single request. State that comes back during the cooldown is
# served immediately, because `rebuild_state` checks for it before the cooldown.
FAILURE_COOLDOWN = 30.0

# Monotonic time of the last failed or contended rebuild, or `None` if there has been
# none. Not 0.0: the monotonic clock can start near zero at boot, which would put a
# worker started then in the cooldown without any failure.
_last_failure: t.Optional[float] = None

# How long, in seconds, state found complete is trusted without checking Redis again.
# Not user-configurable: it trades the cost of the per-request check against how long
# a worker can take to notice that Redis was emptied behind its back. Reads of missing
# state in the meantime fail with `StateError` (a 503) and end the interval early, via
# `mark_stale`. It is short because plugin lists read as empty rather than failing.
READY_INTERVAL = 1.0

# Monotonic time until which state is trusted to be complete.
_ready_until: float = 0.0

# Incremented by `mark_stale`, so a check that started before state was found missing
# cannot mark it ready again when it finishes.
_ready_epoch: int = 0

# The `is_populated` check in flight, shared by the requests that arrive during it, and
# the epoch it started in. `mark_stale` drops it, so no request joins a check that
# started before state was found missing.
_ready_check: t.Optional[t.Tuple["asyncio.Task[bool]", int]] = None


def _initialize() -> None:
    """Write user configuration and the plugin registry to Redis.

    Imported lazily because both of these import `hyperglass.state`.
    """
    # Project
    from hyperglass.plugins import register_all_plugins
    from hyperglass.configuration import init_user_config

    # Deliberately *not* preceded by `state.clear()`. `run()` flushes before
    # initializing, which is correct once at startup, but mid-flight it would wipe
    # state that other workers are reading.
    init_user_config()

    # The plugin registry lives in the same store, so it is lost with the rest of it.
    # Without this, hyperglass recovers but silently stops parsing device output into
    # structured results.
    register_all_plugins()


def is_populated(cache: "RedisManager") -> bool:
    """Determine whether all required state keys exist in Redis."""
    keys = [cache.key(key) for key in REQUIRED_KEYS]
    return cache.instance.exists(*keys) == len(keys)


def in_cooldown() -> bool:
    """Determine whether a recent failed or contended rebuild is still cooling down."""
    if _last_failure is None:
        return False
    return time.monotonic() - _last_failure < FAILURE_COOLDOWN


def mark_stale() -> None:
    """Stop trusting that state is complete, so the next request checks Redis."""
    global _ready_until, _ready_epoch, _ready_check  # noqa: PLW0603
    _ready_until = 0.0
    _ready_epoch += 1
    _ready_check = None


def _retrieve(task: "asyncio.Task[bool]") -> None:
    """Retrieve a shared check's exception, in case every request awaiting it went away."""
    if not task.cancelled():
        task.exception()


async def _shared_is_populated(cache: "RedisManager") -> t.Tuple[bool, int]:
    """Run `is_populated` in a thread, sharing a check already in flight on this loop.

    Returns the result and the epoch the check started in, which is what decides
    whether the result may mark state ready.
    """
    global _ready_check  # noqa: PLW0603
    loop = asyncio.get_running_loop()
    current = _ready_check
    if current is None or current[0].done() or current[0].get_loop() is not loop:
        task = loop.create_task(asyncio.to_thread(is_populated, cache))
        task.add_done_callback(_retrieve)
        current = _ready_check = (task, _ready_epoch)
    task, epoch = current
    # Shielded, so a request that is cancelled does not cancel the others' check.
    return await asyncio.shield(task), epoch


async def ensure_ready(cache: "RedisManager") -> bool:
    """Determine whether state is usable, recovering it if it has been lost.

    State found complete within the last `READY_INTERVAL` is trusted without any I/O.
    Otherwise one shared check per worker asks Redis whether state is complete. Only
    when it is not does each request fall back to `rebuild_state` in a thread, as
    before, which rebuilds or fails fast; during the failure cooldown, requests fail
    without taking a thread at all.
    """
    global _ready_until  # noqa: PLW0603

    if time.monotonic() < _ready_until:
        return True

    populated, epoch = await _shared_is_populated(cache)
    if populated:
        ready = True
    elif in_cooldown():
        # What `rebuild_state` would answer, without a thread-pool job per request.
        return False
    else:
        epoch = _ready_epoch
        ready = await asyncio.to_thread(rebuild_state, cache)

    if ready and epoch == _ready_epoch:
        _ready_until = time.monotonic() + READY_INTERVAL
    return ready


def rebuild_state(cache: "RedisManager") -> bool:
    """Repopulate configuration state in Redis after it has been lost.

    Returns `True` if state is populated by the time this returns, whether this process
    rebuilt it or another one did. Blocks only for the duration of a rebuild this process
    performs itself. If another process (or another thread in this one) holds the rebuild
    lock, returns `False` at once rather than waiting, and starts the cooldown so later
    requests in this process do not contend for the lock until it has passed.
    """
    global _last_failure  # noqa: PLW0603

    if is_populated(cache):
        # State came back between the failed read and now, or the miss was for
        # something this function does not manage.
        return True

    if in_cooldown():
        return False

    lock = cache.key(LOCK_KEY)
    token = str(uuid4()).encode()

    if not cache.instance.set(lock, token, nx=True, ex=LOCK_TIMEOUT):
        # Waiting here would hold a thread-pool thread for as long as the rebuild takes,
        # once per request, which exhausts the pool when the rebuild is slow or failing.
        # Every caller already handles `False` (the request hook answers 503), and
        # `is_populated` above lets requests through as soon as the rebuild finishes.
        _last_failure = time.monotonic()
        log.debug("hyperglass state is being rebuilt elsewhere")
        return False

    try:
        log.bind(keys=REQUIRED_KEYS).warning("hyperglass state is missing from Redis, rebuilding")
        _initialize()
        if not is_populated(cache):
            raise RuntimeError("State initialization did not complete")
    except Exception as error:
        _last_failure = time.monotonic()
        log.bind(error=str(error)).critical("Failed to rebuild hyperglass state")
        return False
    finally:
        if cache.instance.get(lock) == token:
            cache.instance.delete(lock)

    _last_failure = None
    log.bind(generation=cache.get("generation")).warning("Rebuilt hyperglass state")
    return True
