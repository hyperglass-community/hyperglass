"""Provide an isolated Redis store for backend tests."""

# Third Party
import pytest
import fakeredis

# Project
from hyperglass.state import manager, recovery
from hyperglass.state import use_state
from hyperglass.state.hooks import _use_state
from hyperglass.models.config.params import Params
from hyperglass.defaults.directives import init_builtin_directives


@pytest.fixture(autouse=True)
def isolated_redis(monkeypatch):
    """Keep tests independent of local Redis services and application state."""
    server = fakeredis.FakeServer()
    # Each test gets an empty Redis, so readiness found by an earlier test is stale.
    monkeypatch.setattr(recovery, "_ready_until", 0.0)
    monkeypatch.setattr(recovery, "_ready_check", None)
    monkeypatch.setattr(recovery, "_last_failure", None)
    _use_state.cache_clear()
    monkeypatch.setattr(manager, "Redis", lambda **kwargs: fakeredis.FakeRedis(server=server))
    state = use_state()
    state.redis.set("params", Params())
    state.redis.set("directives", init_builtin_directives())
    # An empty plugin registry, registered and ready: plugin managers treat a missing one as
    # lost state.
    state.redis.set(("plugins", "input"), [])
    state.redis.set(("plugins", "output"), [])
    state.redis.set(("plugins", "ready"), True)
    yield
    _use_state.cache_clear()
