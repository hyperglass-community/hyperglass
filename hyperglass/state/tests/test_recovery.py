"""Test state recovery."""

# Standard Library
import typing as t
import asyncio
import pickle
import threading
from fnmatch import fnmatch

# Third Party
import pytest

# Project
from hyperglass.exceptions.private import StateError

# Local
from .. import recovery
from ..redis import RedisManager
from ..store import HyperglassState
from ..recovery import rebuild_state

NAMESPACE = "hyperglass.state"
STATE_KEYS = tuple(f"{NAMESPACE}.{key}" for key in recovery.REQUIRED_KEYS)
LOCK = f"{NAMESPACE}.rebuild.lock"


class FakeRedis:
    """Minimal stand-in for a Redis client."""

    data: t.Dict[str, t.Any]

    def __init__(self, **data: t.Any) -> None:
        self.data = dict(data)

    def exists(self, *names: str) -> int:
        """Count stored keys."""
        return sum(1 for name in names if name in self.data)

    def get(self, name: str) -> t.Any:
        """Read a stored value."""
        return self.data.get(name)

    def set(self, name: str, value: t.Any, nx: bool = False, ex: int = None) -> t.Optional[bool]:
        """Store a value with optional uniqueness."""
        if nx and name in self.data:
            return None
        self.data[name] = value
        return True

    def delete(self, *names: str) -> None:
        """Remove stored keys."""
        for name in names:
            self.data.pop(name, None)

    def scan_iter(self, match: str, count: int = None) -> t.Generator[str, None, None]:
        """Yield matching keys."""
        yield from [key for key in list(self.data) if fnmatch(key, match)]


def cache_with(*keys: str) -> RedisManager:
    """Build a cache manager containing `keys`."""
    return RedisManager(
        instance=FakeRedis(**dict.fromkeys(keys, pickle.dumps(None))), namespace=NAMESPACE
    )


def state_with(cache: RedisManager) -> HyperglassState:
    """Build a state instance around `cache`, without opening a Redis connection."""
    state = HyperglassState.__new__(HyperglassState)
    state.redis = cache
    return state


@pytest.fixture(autouse=True)
def no_cooldown():
    """Ensure a failure in one test does not suppress the rebuild in the next."""
    recovery._last_failure = None
    yield
    recovery._last_failure = None


def test_populated_state_is_not_rebuilt(monkeypatch):
    """State that is present must not be re-initialized."""
    calls = []
    monkeypatch.setattr(recovery, "_initialize", lambda: calls.append(True))
    cache = cache_with(*STATE_KEYS)

    assert rebuild_state(cache) is True
    assert calls == []


def test_partial_state_is_rebuilt(monkeypatch):
    """State missing any required key is rebuilt, and the lock is released."""
    cache = cache_with(STATE_KEYS[0])

    def initialize():
        for key in STATE_KEYS:
            cache.instance.data[key] = pickle.dumps(None)

    monkeypatch.setattr(recovery, "_initialize", initialize)

    assert rebuild_state(cache) is True
    assert cache.instance.exists(*STATE_KEYS) == len(STATE_KEYS)
    assert LOCK not in cache.instance.data


def test_lock_held_elsewhere_fails_fast(monkeypatch):
    """A process that loses the lock does not rebuild in parallel, and does not wait."""
    calls = []
    monkeypatch.setattr(recovery, "_initialize", lambda: calls.append(True))
    monkeypatch.setattr(recovery.time, "sleep", lambda _: pytest.fail("waited for the lock"))
    cache = cache_with(LOCK)

    assert rebuild_state(cache) is False
    assert calls == [], "rebuilt state while another process held the lock"
    assert cache.instance.get(LOCK) is not None, "released another process's lock"


def test_lock_held_elsewhere_starts_cooldown(monkeypatch):
    """A request that loses the lock records the cooldown, so later ones skip the lock."""
    cache = cache_with(LOCK)
    attempts = []
    original_set = cache.instance.set

    def set_(*args, **kwargs):
        attempts.append(args[0])
        return original_set(*args, **kwargs)

    monkeypatch.setattr(cache.instance, "set", set_)

    assert rebuild_state(cache) is False
    assert rebuild_state(cache) is False
    assert attempts == [LOCK], "contended for the lock during the cooldown"


def test_state_rebuilt_elsewhere_is_served_during_cooldown(monkeypatch):
    """The cooldown must not hide state that another process has finished rebuilding."""
    cache = cache_with(LOCK)
    assert rebuild_state(cache) is False

    cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))
    cache.instance.delete(LOCK)

    assert rebuild_state(cache) is True


def test_failure_backs_off(monkeypatch):
    """A failed rebuild is not retried on every request."""
    calls = []

    def initialize():
        calls.append(True)
        raise RuntimeError("bad config")

    monkeypatch.setattr(recovery, "_initialize", initialize)
    cache = cache_with()

    assert rebuild_state(cache) is False
    assert LOCK not in cache.instance.data, "lock left behind after a failed rebuild"

    assert rebuild_state(cache) is False
    assert len(calls) == 1, "configuration was re-read during the failure cooldown"


def test_property_read_rebuilds_lost_state(monkeypatch):
    """Reading a state property directly must recover, not just `use_state`.

    `Query.device` and the query route read `state.devices` and `state.params` off an
    instance on every request, so this is the path that fails in production.
    """
    cache = cache_with()
    state = state_with(cache)

    def initialize():
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))
        cache.set("devices", ["recovered"])

    monkeypatch.setattr(recovery, "_initialize", initialize)

    assert state.devices == ["recovered"]


def test_property_read_raises_when_rebuild_fails(monkeypatch):
    """A rebuild that cannot repopulate state must surface the original error."""

    def initialize():
        raise RuntimeError("bad config")

    monkeypatch.setattr(recovery, "_initialize", initialize)
    state = state_with(cache_with())

    with pytest.raises(StateError):
        _ = state.devices


def test_clear_is_scoped_to_hyperglass():
    """Clearing state must not delete keys belonging to other applications."""
    cache = cache_with(*STATE_KEYS, "someotherapp.session.1")
    state = state_with(cache)

    state.clear()

    assert cache.instance.exists(*STATE_KEYS) == 0
    assert "someotherapp.session.1" in cache.instance.data


def test_configuration_without_plugins_is_not_ready(monkeypatch):
    cache = cache_with(
        *(f"{NAMESPACE}.{key}" for key in ("params", "directives", "devices", "ui_params"))
    )
    calls = []

    def initialize():
        calls.append(True)
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    assert rebuild_state(cache) is True
    assert calls == [True]


def test_incomplete_initialization_is_retried_after_cooldown(monkeypatch):
    cache = cache_with()
    monkeypatch.setattr(recovery, "_initialize", lambda: cache.set("params", {}))
    assert rebuild_state(cache) is False
    assert not recovery.is_populated(cache)
    recovery._last_failure = None

    def initialize():
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    assert rebuild_state(cache) is True


@pytest.mark.asyncio
async def test_async_recovery_does_not_block_event_loop(monkeypatch):
    cache = cache_with()
    state = state_with(cache)
    started = threading.Event()
    release = threading.Event()
    thread_ids = []

    def initialize():
        thread_ids.append(threading.get_ident())
        started.set()
        if not release.wait(timeout=2):
            raise RuntimeError("Event loop did not continue during recovery")
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    task = asyncio.create_task(state.ensure_ready())
    try:
        async with asyncio.timeout(3):
            while not started.is_set():
                await asyncio.sleep(0)
        assert thread_ids != [threading.get_ident()]
    finally:
        release.set()
        await task


@pytest.mark.asyncio
async def test_concurrent_requests_during_rebuild_fail_fast(monkeypatch):
    """Requests that arrive while a rebuild is running return at once.

    One request holds the lock and rebuilds; the rest must fail without occupying a
    thread for the length of the rebuild, so the pool stays free for other work.
    """
    cache = cache_with()
    state = state_with(cache)
    started = threading.Event()
    release = threading.Event()

    def initialize():
        started.set()
        if not release.wait(timeout=5):
            raise RuntimeError("rebuild was never released")
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    rebuild = asyncio.create_task(state.ensure_ready())
    try:
        async with asyncio.timeout(3):
            while not started.is_set():
                await asyncio.sleep(0)
        async with asyncio.timeout(2):
            results = await asyncio.gather(
                *(state.ensure_ready() for _ in range(20)), return_exceptions=True
            )
        assert all(isinstance(result, StateError) for result in results), results
    finally:
        release.set()
    await rebuild
    # Once the rebuild finishes, requests are served despite the cooldown.
    await state.ensure_ready()


@pytest.mark.asyncio
async def test_mid_request_state_loss_never_rebuilds_on_event_loop(monkeypatch):
    calls = []
    monkeypatch.setattr(recovery, "_initialize", lambda: calls.append(True))
    with pytest.raises(StateError):
        _ = state_with(cache_with()).devices
    assert calls == []


def test_generation_and_plugin_readiness_follow_complete_initialization(monkeypatch):
    from hyperglass import configuration
    from hyperglass.state import use_state
    from hyperglass.plugins import register_all_plugins
    from hyperglass.models.directive import Directives
    from hyperglass.models.config.devices import Devices

    state = use_state()
    devices = Devices(
        {
            "name": "test",
            "address": "192.0.2.1",
            "platform": "frr",
            "credential": {"username": "test", "password": "test"},
            "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
        }
    )
    monkeypatch.setattr(configuration, "init_files", lambda: None)
    monkeypatch.setattr(configuration, "init_directives", Directives)
    monkeypatch.setattr(configuration, "init_ui_params", lambda **kwargs: {})
    configuration.init_user_config(params=state.params, devices=devices)
    first_generation = state.generation
    assert first_generation is not None
    assert not recovery.is_populated(state.redis)
    register_all_plugins()
    assert recovery.is_populated(state.redis)
    assert state.plugins("output")

    configuration.init_user_config(params=state.params, devices=devices)
    assert state.generation != first_generation
    assert not recovery.is_populated(state.redis)


def test_api_request_recovers_before_reading_state(monkeypatch):
    from litestar.testing import TestClient

    from hyperglass.state import use_state
    from hyperglass.settings import Settings

    monkeypatch.setattr(Settings, "disable_ui", True)
    from hyperglass.api import app

    state = use_state()
    params = state.params
    calls = []

    def initialize():
        calls.append(threading.get_ident())
        for key in recovery.REQUIRED_KEYS:
            state.cache.set(key, None)
        state.cache.set("params", params)

    monkeypatch.setattr(recovery, "_initialize", initialize)
    state.clear()
    with TestClient(app=app) as client:
        response = client.get("/api/info")
    assert response.status_code == 200
    assert len(calls) == 1


def test_api_requests_get_fast_503_while_state_is_missing(monkeypatch):
    """Concurrent API requests during a missing-state window get a prompt 503.

    The rebuild lock is held by another process and never released, which is what a
    slow or wedged rebuild looks like from this worker.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor

    from litestar.testing import TestClient

    from hyperglass.state import use_state
    from hyperglass.settings import Settings

    monkeypatch.setattr(Settings, "disable_ui", True)
    from hyperglass.api import app

    state = use_state()
    calls = []
    monkeypatch.setattr(recovery, "_initialize", lambda: calls.append(True))
    state.clear()
    state.cache.instance.set(state.cache.key(recovery.LOCK_KEY), b"other", ex=60)

    with TestClient(app=app) as client:
        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=10) as pool:
            responses = list(pool.map(lambda _: client.get("/api/info"), range(10)))
        elapsed = time.monotonic() - started

    assert [response.status_code for response in responses] == [503] * 10
    assert calls == [], "rebuilt state while another process held the lock"
    assert elapsed < 5, f"requests waited {elapsed:.1f}s for another process's rebuild"


def test_api_requests_get_503_after_failed_rebuild(monkeypatch):
    """A failed rebuild answers 503 and is not retried for every request."""
    from litestar.testing import TestClient

    from hyperglass.state import use_state
    from hyperglass.settings import Settings

    monkeypatch.setattr(Settings, "disable_ui", True)
    from hyperglass.api import app

    state = use_state()
    calls = []

    def initialize():
        calls.append(True)
        raise RuntimeError("bad config")

    monkeypatch.setattr(recovery, "_initialize", initialize)
    state.clear()
    with TestClient(app=app) as client:
        statuses = [client.get("/api/info").status_code for _ in range(3)]
    assert statuses == [503] * 3
    assert calls == [True]


@pytest.fixture
def to_thread_calls(monkeypatch):
    """Record the functions `recovery` hands to the thread pool."""
    calls = []
    original = asyncio.to_thread

    async def to_thread(func, *args, **kwargs):
        calls.append(func.__name__)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(recovery.asyncio, "to_thread", to_thread)
    return calls


@pytest.mark.asyncio
async def test_ready_state_is_checked_without_the_thread_pool(to_thread_calls):
    """Once state is found complete, requests do not take a thread-pool job (#532)."""
    state = state_with(cache_with(*STATE_KEYS))

    await state.ensure_ready()
    assert to_thread_calls == ["is_populated"]

    for _ in range(50):
        await state.ensure_ready()
    assert to_thread_calls == ["is_populated"], "checked state in a thread on the hot path"


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_check(monkeypatch, to_thread_calls):
    """Requests arriving while a check is in flight wait for it instead of starting more."""
    state = state_with(cache_with(*STATE_KEYS))
    release = threading.Event()
    original = recovery.is_populated

    def is_populated(cache):
        if not release.wait(timeout=2):
            raise RuntimeError("check was never released")
        return original(cache)

    monkeypatch.setattr(recovery, "is_populated", is_populated)
    requests = [asyncio.create_task(state.ensure_ready()) for _ in range(20)]
    await asyncio.sleep(0.05)
    release.set()
    async with asyncio.timeout(3):
        await asyncio.gather(*requests)
    assert to_thread_calls == ["is_populated"]


@pytest.mark.asyncio
async def test_ready_state_is_rechecked_after_the_interval(monkeypatch):
    """State lost without any request noticing is rebuilt once the interval passes."""
    cache = cache_with(*STATE_KEYS)
    state = state_with(cache)
    now = [1000.0]
    monkeypatch.setattr(recovery.time, "monotonic", lambda: now[0])
    calls = []

    def initialize():
        calls.append(True)
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    await state.ensure_ready()

    cache.instance.data.clear()
    await state.ensure_ready()
    assert calls == [], "rechecked state inside the interval"

    now[0] += recovery.READY_INTERVAL
    await state.ensure_ready()
    assert calls == [True]
    assert recovery.is_populated(cache)


@pytest.mark.asyncio
async def test_missing_state_read_ends_the_interval(monkeypatch):
    """A request that finds state missing makes the next one recover at once."""
    cache = cache_with(*STATE_KEYS)
    state = state_with(cache)
    calls = []

    def initialize():
        calls.append(True)
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    await state.ensure_ready()

    cache.instance.data.clear()
    with pytest.raises(StateError):
        _ = state.devices

    await state.ensure_ready()
    assert calls == [True]


@pytest.mark.asyncio
async def test_clear_ends_the_interval(monkeypatch):
    cache = cache_with(*STATE_KEYS)
    state = state_with(cache)
    calls = []

    def initialize():
        calls.append(True)
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    await state.ensure_ready()
    state.clear()
    await state.ensure_ready()
    assert calls == [True]


@pytest.mark.asyncio
async def test_check_started_before_state_was_lost_does_not_mark_it_ready(monkeypatch):
    """A check that saw complete state must not vouch for it after a read found it gone."""
    state = state_with(cache_with(*STATE_KEYS))
    started = threading.Event()
    release = threading.Event()
    original = recovery.is_populated

    def is_populated(cache):
        started.set()
        if not release.wait(timeout=2):
            raise RuntimeError("check was never released")
        return original(cache)

    monkeypatch.setattr(recovery, "is_populated", is_populated)
    request = asyncio.create_task(state.ensure_ready())
    async with asyncio.timeout(3):
        while not started.is_set():
            await asyncio.sleep(0)
    recovery.mark_stale()
    release.set()
    await request
    assert recovery._ready_until == 0.0


@pytest.mark.asyncio
async def test_cooldown_fails_without_a_thread_per_request(monkeypatch, to_thread_calls):
    """During the failure cooldown, requests share one check and do not rebuild."""

    def initialize():
        raise RuntimeError("bad config")

    monkeypatch.setattr(recovery, "_initialize", initialize)
    state = state_with(cache_with())

    with pytest.raises(StateError):
        await state.ensure_ready()
    assert to_thread_calls == ["is_populated", "rebuild_state"]

    for _ in range(5):
        with pytest.raises(StateError):
            await state.ensure_ready()
    assert "rebuild_state" not in to_thread_calls[2:]


def test_api_requests_check_state_once_per_interval(monkeypatch):
    """A burst of requests to any route costs one state check per worker (#532)."""
    from litestar.testing import TestClient

    from hyperglass.settings import Settings

    monkeypatch.setattr(Settings, "disable_ui", True)
    from hyperglass.api import app

    from hyperglass.state import use_state

    state = use_state()
    for key in recovery.REQUIRED_KEYS:
        if not state.cache.instance.exists(state.cache.key(key)):
            state.cache.set(key, None)
    checks = []
    original = recovery.is_populated

    def is_populated(cache):
        checks.append(True)
        return original(cache)

    monkeypatch.setattr(recovery, "is_populated", is_populated)
    # A frozen clock, so a slow runner cannot reach the end of the interval.
    monkeypatch.setattr(recovery.time, "monotonic", lambda: 1000.0)
    with TestClient(app=app) as client:
        statuses = [client.get("/api/info").status_code for _ in range(20)]
    assert statuses == [200] * 20
    assert len(checks) == 1


@pytest.mark.asyncio
async def test_request_after_mark_stale_does_not_join_the_earlier_check(monkeypatch):
    """A request arriving after state was found missing starts its own check."""
    state = state_with(cache_with(*STATE_KEYS))
    started = threading.Event()
    release = threading.Event()
    calls = []
    original = recovery.is_populated

    def is_populated(cache):
        calls.append(True)
        if len(calls) == 1:
            started.set()
            if not release.wait(timeout=2):
                raise RuntimeError("check was never released")
        return original(cache)

    monkeypatch.setattr(recovery, "is_populated", is_populated)
    first = asyncio.create_task(state.ensure_ready())
    async with asyncio.timeout(3):
        while not started.is_set():
            await asyncio.sleep(0)
    recovery.mark_stale()
    second = asyncio.create_task(state.ensure_ready())
    await asyncio.sleep(0.05)
    release.set()
    async with asyncio.timeout(3):
        await asyncio.gather(first, second)
    assert len(calls) == 2, "joined a check that started before state was found missing"


@pytest.mark.asyncio
async def test_joined_check_from_an_older_epoch_does_not_mark_ready(monkeypatch):
    """The epoch that counts is the shared check's, not the joining request's."""
    state = state_with(cache_with(*STATE_KEYS))
    started = threading.Event()
    release = threading.Event()
    original = recovery.is_populated

    def is_populated(cache):
        started.set()
        if not release.wait(timeout=2):
            raise RuntimeError("check was never released")
        return original(cache)

    monkeypatch.setattr(recovery, "is_populated", is_populated)
    first = asyncio.create_task(state.ensure_ready())
    async with asyncio.timeout(3):
        while not started.is_set():
            await asyncio.sleep(0)
    # State found missing, but the in-flight check is still shared (as if a request
    # had already picked it up before `mark_stale` dropped it).
    monkeypatch.setattr(recovery, "_ready_epoch", recovery._ready_epoch + 1)
    joiner = asyncio.create_task(state.ensure_ready())
    await asyncio.sleep(0.05)
    release.set()
    async with asyncio.timeout(3):
        await asyncio.gather(first, joiner)
    assert recovery._ready_until == 0.0


def test_clear_ends_the_interval_after_deleting(monkeypatch):
    """A check that trusts state while `clear` is deleting it is not left standing."""
    cache = cache_with(*STATE_KEYS)
    state = state_with(cache)
    original = cache.instance.delete

    def delete(*names):
        # A concurrent check finds state complete just before it is deleted.
        monkeypatch.setattr(recovery, "_ready_until", float("inf"))
        original(*names)

    monkeypatch.setattr(cache.instance, "delete", delete)
    state.clear()
    assert recovery._ready_until == 0.0


def test_no_cooldown_without_a_failure_right_after_boot(monkeypatch):
    """A monotonic clock near zero, as right after boot, is not a recent failure."""
    monkeypatch.setattr(recovery.time, "monotonic", lambda: 5.0)
    cache = cache_with()

    def initialize():
        cache.instance.data.update(dict.fromkeys(STATE_KEYS, pickle.dumps(None)))

    monkeypatch.setattr(recovery, "_initialize", initialize)
    assert not recovery.in_cooldown()
    assert rebuild_state(cache) is True


def test_failure_right_after_boot_still_cools_down(monkeypatch):
    monkeypatch.setattr(recovery.time, "monotonic", lambda: 5.0)

    def initialize():
        raise RuntimeError("bad config")

    monkeypatch.setattr(recovery, "_initialize", initialize)
    assert rebuild_state(cache_with()) is False
    assert recovery.in_cooldown()


def test_missing_plugin_registry_is_lost_state(monkeypatch):
    """Plugin managers fail on a lost registry instead of running without plugins.

    A query run without output plugins would cache unparsed output for the whole
    cache timeout. Other readers, such as `hyperglass plugins`, still read it as empty.
    """
    from hyperglass.state import use_state
    from hyperglass.plugins._manager import InputPluginManager, OutputPluginManager

    state = use_state()
    monkeypatch.setattr(recovery, "_ready_until", float("inf"))
    state.cache.delete(("plugins", "output"))

    with pytest.raises(StateError):
        OutputPluginManager().plugins()
    assert recovery._ready_until == 0.0, "a lost registry did not end the interval"
    assert InputPluginManager().plugins() == []
    assert state.plugins("output") == []


def test_cooldown_check_survives_a_concurrent_reset(monkeypatch):
    """A rebuild finishing in another thread mid-check must not break `in_cooldown`."""
    monkeypatch.setattr(recovery, "_last_failure", 100.0)

    def monotonic():
        # Another thread's successful rebuild resets the failure time right now.
        recovery._last_failure = None
        return 110.0

    monkeypatch.setattr(recovery.time, "monotonic", monotonic)
    assert recovery.in_cooldown() is True
