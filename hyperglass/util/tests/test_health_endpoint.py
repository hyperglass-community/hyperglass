"""Tests for the /api/health endpoint."""

# Standard Library
import time
import asyncio
import threading

# Third Party
import pytest
from litestar.testing import TestClient, AsyncTestClient
from redis.exceptions import RedisError

# Project
from hyperglass.settings import Settings
from hyperglass.state.recovery import REQUIRED_KEYS

# hyperglass.api reads state when it is imported, so it is imported inside the
# fixtures, after the autouse fixture in conftest.py has seeded the isolated store.


@pytest.fixture(autouse=True)
def fresh_health_check():
    """Start each test without a shared check run or cached Redis client."""
    # Project
    from hyperglass.api import routes

    routes.shared_health_check.reset()
    routes._health_redis.clear()
    yield
    routes.shared_health_check.reset()
    routes._health_redis.clear()


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
    monkeypatch.setattr(recovery, "_last_failure", None)
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


class FakeRedis:
    """Record client creation and pings instead of connecting to Redis."""

    created = []
    pings = 0

    @classmethod
    def from_url(cls, dsn, **kwargs):
        """Record the client options instead of connecting."""
        cls.created.append({"dsn": dsn, **kwargs})
        return cls()

    def ping(self):
        """Count the ping."""
        type(self).pings += 1


@pytest.fixture
def fake_redis(monkeypatch):
    # Project
    from hyperglass.api import routes

    FakeRedis.created = []
    FakeRedis.pings = 0
    monkeypatch.setattr(routes, "Redis", FakeRedis)
    return FakeRedis


def test_ping_redis_uses_short_timeouts(fake_redis):
    # Project
    from hyperglass.api import routes

    routes.ping_redis("redis://[2001:db8::1]:6379/1")
    assert fake_redis.created == [
        {
            "dsn": "redis://[2001:db8::1]:6379/1",
            "socket_connect_timeout": routes.HEALTH_REDIS_TIMEOUT,
            "socket_timeout": routes.HEALTH_REDIS_TIMEOUT,
        }
    ]
    assert fake_redis.pings == 1


def test_ping_redis_reuses_one_client(fake_redis):
    """Repeated probes share one client, so they do not open new connections."""
    # Project
    from hyperglass.api import routes

    for _ in range(5):
        routes.ping_redis("redis://127.0.0.1:6379/1")
    assert len(fake_redis.created) == 1
    assert fake_redis.pings == 5


def test_health_reuses_result_within_interval(populate, ui_built, fake_redis):
    # Project
    from hyperglass.api import app

    with TestClient(app=app) as client:
        responses = [client.get("/api/health") for _ in range(10)]
    assert {response.status_code for response in responses} == {200}
    assert len(fake_redis.created) == 1
    assert fake_redis.pings == 1


def test_health_checks_again_after_interval(populate, ui_built, fake_redis, monkeypatch):
    # Project
    from hyperglass.api import app, routes

    monkeypatch.setattr(routes, "HEALTH_CACHE_SECONDS", 0.05)
    with TestClient(app=app) as client:
        client.get("/api/health")
        time.sleep(0.1)
        client.get("/api/health")
    assert fake_redis.pings == 2
    assert len(fake_redis.created) == 1


@pytest.mark.asyncio
async def test_concurrent_health_requests_share_one_probe(populate, ui_built, monkeypatch):
    """Requests that arrive during a probe wait for it instead of starting more."""
    # Project
    from hyperglass.api import app

    pings = 0
    release = threading.Event()

    def slow_ping(_):
        nonlocal pings
        pings += 1
        release.wait(5)

    monkeypatch.setattr("hyperglass.api.routes.ping_redis", slow_ping)
    async with AsyncTestClient(app=app) as client:
        requests = [asyncio.ensure_future(client.get("/api/health")) for _ in range(10)]
        await asyncio.sleep(0.2)
        release.set()
        responses = await asyncio.gather(*requests)
    assert {response.status_code for response in responses} == {200}
    assert pings == 1


@pytest.mark.asyncio
async def test_disconnected_request_does_not_cancel_shared_probe(populate, ui_built, monkeypatch):
    # Project
    from hyperglass.api import routes
    from hyperglass.state import use_state

    release = threading.Event()
    monkeypatch.setattr(routes, "ping_redis", lambda _: release.wait(5))
    first = asyncio.ensure_future(routes.shared_health_check.checks(use_state()))
    second = asyncio.ensure_future(routes.shared_health_check.checks(use_state()))
    await asyncio.sleep(0.1)
    first.cancel()
    release.set()
    assert (await second)["redis"] == "ok"


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
