"""Tests for the /api/health endpoint."""

# Standard Library
import time

# Third Party
import pytest
from litestar.testing import TestClient
from redis.exceptions import RedisError

# Project
from hyperglass.settings import Settings
from hyperglass.state.recovery import REQUIRED_KEYS

# hyperglass.api reads state when it is imported, so it is imported inside the
# fixtures, after the autouse fixture in conftest.py has seeded the isolated store.


@pytest.fixture
def populate(monkeypatch):
    """Stand in for loading /etc/hyperglass, so state recovery succeeds."""
    # Project
    from hyperglass.state import recovery, use_state

    state = use_state()
    params = state.params

    def initialize():
        for key in REQUIRED_KEYS:
            state.cache.set(key, None)
        state.cache.set("params", params)

    monkeypatch.setattr(recovery, "_initialize", initialize)
    # Start each test outside any cooldown left by an earlier failed rebuild.
    monkeypatch.setattr(recovery, "_last_failure", 0.0)
    initialize()
    return state


@pytest.fixture
def ui_built(monkeypatch, tmp_path):
    """Point the static path at a directory containing a built UI."""
    (tmp_path / "ui").mkdir()
    (tmp_path / "ui" / "index.html").write_text("<html></html>")
    monkeypatch.setattr(type(Settings), "static_path", property(lambda _: tmp_path))
    monkeypatch.setattr(Settings, "disable_ui", False)
    return tmp_path


@pytest.fixture
def redis_reachable(monkeypatch):
    """Answer the health check's dedicated Redis probe without a real Redis."""
    monkeypatch.setattr("hyperglass.api.routes.ping_redis", lambda _: None)


@pytest.fixture
def client(populate, redis_reachable):
    # Project
    from hyperglass.api import app

    with TestClient(app=app) as test_client:
        yield test_client


def test_health_ok(client, ui_built):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {"redis": "ok", "state": "ok", "ui": "ok"},
    }


def test_health_fails_when_redis_unreachable(client, ui_built, monkeypatch):
    def unreachable(_):
        raise ConnectionError("Connection refused")

    monkeypatch.setattr("hyperglass.api.routes.ping_redis", unreachable)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {
        "status": "error",
        "checks": {"redis": "error", "state": "error", "ui": "ok"},
    }
    # Failure details are logged, never returned to unauthenticated clients.
    assert "refused" not in response.text


def test_health_skips_shared_pool_state_hook_when_redis_unreachable(client, ui_built, monkeypatch):
    """The app-wide state recovery hook must not run before the bounded probe."""
    # Project
    from hyperglass.state import HyperglassState

    def unreachable(_):
        raise ConnectionError("Connection refused")

    async def hang(_):
        raise AssertionError("state recovery must not run when Redis is unreachable")

    monkeypatch.setattr("hyperglass.api.routes.ping_redis", unreachable)
    monkeypatch.setattr(HyperglassState, "ensure_ready", hang)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["checks"]["redis"] == "error"


def test_health_recovers_lost_state(client, ui_built, populate):
    populate.cache.delete("devices")
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["checks"]["state"] == "ok"
    assert populate.cache.get("params") is not None


def test_health_fails_when_state_cannot_be_recovered(client, ui_built, populate, monkeypatch):
    # Project
    from hyperglass.state import recovery

    def fail():
        raise RuntimeError("config.yaml is invalid")

    monkeypatch.setattr(recovery, "_initialize", fail)
    populate.cache.delete("devices")
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["checks"] == {"redis": "ok", "state": "error", "ui": "ok"}
    assert "invalid" not in response.text


def test_health_fails_when_ui_not_built(client, ui_built):
    (ui_built / "ui" / "index.html").unlink()
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["checks"]["ui"] == "error"


def test_health_ignores_ui_when_disabled(client, ui_built, monkeypatch):
    (ui_built / "ui" / "index.html").unlink()
    monkeypatch.setattr(Settings, "disable_ui", True)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["checks"]["ui"] == "disabled"


def test_health_not_in_openapi_schema(client):
    # Project
    from hyperglass.api import app

    assert "/api/health" not in app.openapi_schema.paths


def test_ping_redis_uses_short_timeouts(monkeypatch):
    # Project
    from hyperglass.api import routes

    calls = {}

    class FakeRedis:
        @classmethod
        def from_url(cls, dsn, **kwargs):
            calls.update(dsn=dsn, **kwargs)
            return cls()

        def ping(self):
            calls["pinged"] = True

        def close(self):
            calls["closed"] = True

    monkeypatch.setattr(routes, "Redis", FakeRedis)
    routes.ping_redis("redis://[2001:db8::1]:6379/1")
    assert calls == {
        "dsn": "redis://[2001:db8::1]:6379/1",
        "socket_connect_timeout": routes.HEALTH_REDIS_TIMEOUT,
        "socket_timeout": routes.HEALTH_REDIS_TIMEOUT,
        "pinged": True,
        "closed": True,
    }


def test_ping_redis_fails_fast_when_unreachable(monkeypatch):
    # Project
    from hyperglass.api import routes

    monkeypatch.setattr(routes, "HEALTH_REDIS_TIMEOUT", 0.5)

    # A TEST-NET-1 address drops packets (or is rejected at once), so the
    # connect cannot complete; the probe must give up within its timeout.
    start = time.monotonic()
    with pytest.raises(RedisError):
        routes.ping_redis("redis://192.0.2.1:6379/0")
    assert time.monotonic() - start < 5
