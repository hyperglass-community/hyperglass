"""A query that finds the plugin registry lost or not ready is not run or cached (#532)."""

# Third Party
import pytest
from litestar.testing import TestClient

# Project
from hyperglass.state import recovery, use_state
from hyperglass.settings import Settings
from hyperglass.models.config.devices import Devices

QUERY = {
    "queryLocation": "test",
    "queryType": "__hyperglass_frr_bgp_route__",
    "queryTarget": "192.0.2.0/24",
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(Settings, "disable_ui", True)
    # Project
    from hyperglass.api import app, routes
    from hyperglass.plugins._manager import OutputPluginManager

    state = use_state()
    state.redis.set(
        "devices",
        Devices(
            {
                "name": "test",
                "address": "192.0.2.1",
                "platform": "frr",
                "structured_output": False,
                "credential": {"username": "test", "password": "test"},
                "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
            }
        ),
    )
    for key in recovery.REQUIRED_KEYS:
        if not state.cache.instance.exists(state.cache.key(key)):
            state.cache.set(key, None)

    async def execute(data):
        # Stand-in for the device, with the output stage a real query runs.
        return OutputPluginManager().execute(output="raw device output", query=data)

    monkeypatch.setattr(routes, "_execute_query", execute)
    with TestClient(app=app) as test_client:
        yield test_client


def cached_queries():
    redis = use_state().redis
    # The same namespacing the query route's cache writes get.
    pattern = redis.key("hyperglass.query") + ".*"
    return list(redis.instance.scan_iter(match=pattern))


def test_query_with_registry_runs_and_is_cached(client):
    """Control: with the registry in place, the same query succeeds and is cached."""
    response = client.post("/api/query", json=QUERY)
    assert response.is_success, response.text
    assert cached_queries()


@pytest.mark.parametrize(
    "key",
    [("plugins", "input"), ("plugins", "output"), ("plugins", "ready")],
    ids=["input-missing", "output-missing", "not-ready"],
)
def test_query_without_registry_is_503_and_not_cached(client, monkeypatch, key):
    """Lost or rebuilding registry: 503, nothing cached, and the next check is not skipped.

    The readiness window is armed first, as it is during the second after a check, so
    the request reaches the plugin managers instead of being stopped by the hook.
    """
    assert client.post("/api/query", json={**QUERY, "queryTarget": "198.51.100.0/24"}).is_success
    use_state().redis.instance.delete(*cached_queries())
    assert cached_queries() == []
    monkeypatch.setattr(recovery, "_ready_until", float("inf"))
    use_state().cache.delete(key)

    response = client.post("/api/query", json=QUERY)

    assert response.status_code == 503, response.text
    assert cached_queries() == []
    assert recovery._ready_until == 0.0
