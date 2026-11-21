"""Tests for Prometheus metrics."""

# Standard Library
import os
import typing as t

# Third Party
import pytest
from litestar.testing import TestClient
from prometheus_client import REGISTRY

# Project
from hyperglass.main import prepare_metrics_dir
from hyperglass.settings import Settings
from hyperglass.exceptions.public import AuthError, DeviceTimeout, QueryLocationNotFound
from hyperglass.models.config.params import Params
from hyperglass.models.config.devices import Devices

DEVICE = "test"
QUERY_TYPE = "__hyperglass_juniper_bgp_route__"
QUERY = {"queryLocation": DEVICE, "queryTarget": "192.0.2.0/24", "queryType": QUERY_TYPE}
LABELS = {"device": DEVICE, "query_type": QUERY_TYPE}


# hyperglass.api reads state when it is imported, so it is imported inside the
# tests, after the autouse fixture in conftest.py has seeded the isolated store.


def sample(name: str, **labels: str) -> float:
    return REGISTRY.get_sample_value(name, labels) or 0.0


def build_client(
    monkeypatch, *, raise_server_exceptions: bool = True, **params: t.Any
) -> TestClient:
    """Build an app from `params`, with one device and fully populated state.

    `hyperglass.api.app` is built once, at first import, from whatever state
    exists then, so build a fresh app from this test's state instead.
    """
    # Project
    from hyperglass.state import recovery, use_state

    monkeypatch.setattr(Settings, "disable_ui", True)
    state = use_state()
    devices = Devices(
        {
            "name": DEVICE,
            "address": "192.0.2.1",
            "platform": "juniper",
            "credential": {"username": "test", "password": "test"},
            "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
        }
    )

    def initialize():
        for key in recovery.REQUIRED_KEYS:
            state.cache.set(key, [] if key.startswith("plugins.") else None)
        state.cache.set("params", Params(**params))
        state.cache.set("devices", devices)

    monkeypatch.setattr(recovery, "_initialize", initialize)
    initialize()

    # Project
    from hyperglass.api import create_app

    return TestClient(app=create_app(), raise_server_exceptions=raise_server_exceptions)


@pytest.fixture
def metrics_client(monkeypatch) -> t.Generator[TestClient, None, None]:
    with build_client(monkeypatch, fake_output=True, metrics={"enable": True}) as client:
        yield client


def test_metrics_endpoint_exposes_hyperglass_metrics(metrics_client):
    response = metrics_client.get("/metrics")
    assert response.status_code == 200
    assert "hyperglass_build_info" in response.text
    assert "hyperglass_queries_total" in response.text


def test_metrics_disabled_by_default(monkeypatch):
    with build_client(monkeypatch, fake_output=True) as client:
        assert client.get("/metrics").status_code == 404


def test_metrics_path_is_configurable(monkeypatch):
    params = {"fake_output": True, "metrics": {"enable": True, "path": "/internal/metrics"}}
    with build_client(monkeypatch, **params) as client:
        assert "hyperglass_build_info" in client.get("/internal/metrics").text


def test_metrics_endpoint_skips_state_recovery(metrics_client, monkeypatch):
    """Scraping must not depend on Redis-backed state, e.g. during a Redis outage."""
    # Project
    from hyperglass.state import HyperglassState

    async def fail(_):
        raise AssertionError("state recovery must not run for the metrics endpoint")

    monkeypatch.setattr(HyperglassState, "ensure_ready", fail)
    assert metrics_client.get("/metrics").status_code == 200


def test_metrics_not_in_openapi_schema(metrics_client):
    assert "/metrics" not in metrics_client.app.openapi_schema.paths


def test_successful_query_counted(metrics_client):
    before = sample("hyperglass_queries_total", **LABELS, status="success")
    durations = sample("hyperglass_query_duration_seconds_count", **LABELS)
    hits = sample("hyperglass_query_cache_total", result="hit")
    misses = sample("hyperglass_query_cache_total", result="miss")

    payload = {**QUERY, "queryTarget": "198.51.100.0/24"}
    assert metrics_client.post("/api/query", json=payload).status_code == 201
    assert metrics_client.post("/api/query", json=payload).status_code == 201

    assert sample("hyperglass_queries_total", **LABELS, status="success") == before + 2
    # Only the first (uncached) query is executed against the device.
    assert sample("hyperglass_query_duration_seconds_count", **LABELS) == durations + 1
    assert sample("hyperglass_query_cache_total", result="miss") == misses + 1
    assert sample("hyperglass_query_cache_total", result="hit") == hits + 1


class TestDeviceFailures:
    """Failures raised while executing a query against a device."""

    @pytest.fixture
    def metrics_client(self, monkeypatch) -> t.Generator[TestClient, None, None]:
        """Execute against the (patched) device driver rather than fake output."""
        with build_client(monkeypatch, fake_output=False, metrics={"enable": True}) as client:
            yield client

    @pytest.mark.parametrize(
        ("error", "reason"),
        [
            (
                lambda q: DeviceTimeout(error=TimeoutError("timed out"), device=q.device),
                "device_timeout",
            ),
            (lambda q: AuthError(error=PermissionError("denied"), device=q.device), "auth_error"),
            (lambda q: RuntimeError("boom"), "internal_error"),
        ],
    )
    def test_counted_with_reason(self, metrics_client, monkeypatch, error, reason):
        """Device failures are attributed to the device, with the failure reason."""

        async def fail(query):
            raise error(query)

        monkeypatch.setattr("hyperglass.api.routes.execute", fail)
        before = sample("hyperglass_query_errors_total", **LABELS, reason=reason)
        errors = sample("hyperglass_queries_total", **LABELS, status="error")
        durations = sample("hyperglass_query_duration_seconds_count", **LABELS)

        payload = {**QUERY, "queryTarget": "203.0.113.0/24"}
        response = metrics_client.post("/api/query", json=payload)

        assert response.status_code >= 400
        assert sample("hyperglass_query_errors_total", **LABELS, reason=reason) == before + 1
        assert sample("hyperglass_queries_total", **LABELS, status="error") == errors + 1
        # Durations cover successful queries only.
        assert sample("hyperglass_query_duration_seconds_count", **LABELS) == durations

    def test_execution_deadline_counted_as_device_timeout(self, metrics_client, monkeypatch):
        """The overall execution deadline is reported as a device timeout."""
        # Standard Library
        import asyncio

        # Project
        from hyperglass.state import use_state

        params = use_state("params").model_copy(update={"request_timeout": 1.5})
        monkeypatch.setattr("hyperglass.api.routes.use_state", lambda *_: params)

        async def hang(_):
            await asyncio.sleep(5)

        monkeypatch.setattr("hyperglass.api.routes.execute", hang)
        before = sample("hyperglass_query_errors_total", **LABELS, reason="device_timeout")

        response = metrics_client.post(
            "/api/query", json={**QUERY, "queryTarget": "192.0.2.128/25"}
        )

        assert response.status_code >= 400
        assert sample("hyperglass_query_errors_total", **LABELS, reason="device_timeout") == (
            before + 1
        )


def test_failure_counted_once_when_error_handler_fails(monkeypatch):
    """A handler that fails (e.g. reading params during a Redis outage) is called again."""
    with build_client(
        monkeypatch, raise_server_exceptions=False, fake_output=False, metrics={"enable": True}
    ) as client:

        async def fail(_):
            raise RuntimeError("boom")

        class RedisDown:
            @property
            def params(self):
                raise ConnectionError("Redis is unreachable")

        monkeypatch.setattr("hyperglass.api.routes.execute", fail)
        monkeypatch.setattr("hyperglass.api.error_handlers.use_state", RedisDown)
        labels = {**LABELS, "reason": "internal_error"}
        before = sample("hyperglass_query_errors_total", **labels)
        errors = sample("hyperglass_queries_total", **LABELS, status="error")

        payload = {**QUERY, "queryTarget": "192.0.2.32/27"}
        assert client.post("/api/query", json=payload).status_code == 500

        assert sample("hyperglass_query_errors_total", **labels) == before + 1
        assert sample("hyperglass_queries_total", **LABELS, status="error") == errors + 1


def test_invalid_location_counted_without_untrusted_labels(metrics_client):
    labels = {"device": "unknown", "query_type": "unknown"}
    reason = "query_location_not_found"
    before = sample("hyperglass_query_errors_total", **labels, reason=reason)

    response = metrics_client.post("/api/query", json={**QUERY, "queryLocation": "attacker-chosen"})

    assert response.status_code >= 400
    assert sample("hyperglass_query_errors_total", **labels, reason=reason) == before + 1
    assert "attacker-chosen" not in metrics_client.get("/metrics").text


def test_malformed_request_counted(metrics_client):
    labels = {"device": "unknown", "query_type": "unknown", "reason": "invalid_request"}
    before = sample("hyperglass_query_errors_total", **labels)

    response = metrics_client.post("/api/query", json={"queryTarget": "192.0.2.0/24"})

    assert response.status_code == 400
    assert sample("hyperglass_query_errors_total", **labels) == before + 1


def test_state_unavailable_counted(metrics_client, monkeypatch):
    # Project
    from hyperglass.state import HyperglassState
    from hyperglass.exceptions.private import StateError

    async def unavailable(_):
        raise StateError("Hyperglass state is unavailable")

    monkeypatch.setattr(HyperglassState, "ensure_ready", unavailable)
    labels = {"device": "unknown", "query_type": "unknown", "reason": "service_unavailable"}
    before = sample("hyperglass_query_errors_total", **labels)

    assert metrics_client.post("/api/query", json=QUERY).status_code == 503
    assert sample("hyperglass_query_errors_total", **labels) == before + 1


def test_non_query_errors_not_counted(metrics_client):
    labels = {"device": "unknown", "query_type": "unknown", "status": "error"}
    before = sample("hyperglass_queries_total", **labels)
    assert metrics_client.get("/api/devices/nonexistent").status_code >= 400
    assert sample("hyperglass_queries_total", **labels) == before


def test_http_metrics_group_paths(metrics_client):
    assert metrics_client.get(f"/api/devices/{DEVICE}").status_code == 200
    text = metrics_client.get("/metrics").text
    assert 'path="/api/devices/{id}"' in text
    assert f'path="/api/devices/{DEVICE}"' not in text


def test_http_metrics_exclude_health_and_metrics(metrics_client, monkeypatch):
    monkeypatch.setattr("hyperglass.api.routes.ping_redis", lambda _: None)
    metrics_client.get("/api/health")
    metrics_client.get("/metrics")
    text = metrics_client.get("/metrics").text
    assert 'path="/api/health"' not in text
    assert 'path="/metrics"' not in text


def test_error_reason_is_snake_case_class_name():
    # Project
    from hyperglass.api.metrics import error_reason

    assert error_reason(QueryLocationNotFound(location="x")) == "query_location_not_found"


def test_record_query_error_ignores_request_stand_ins():
    # Standard Library
    from types import SimpleNamespace

    # Project
    from hyperglass.api.metrics import record_query_error

    # Handlers are also called with stand-ins in tests; recording must not raise.
    record_query_error(SimpleNamespace(method="POST"), RuntimeError("boom"))


def test_metric_failure_does_not_fail_the_query(metrics_client, monkeypatch):
    # Project
    from hyperglass.api import metrics

    class Broken:
        def labels(self, *_):
            raise OSError("No space left on device")

    for name in ("QUERIES", "QUERY_CACHE", "QUERY_DURATION"):
        monkeypatch.setattr(metrics, name, Broken())

    payload = {**QUERY, "queryTarget": "192.0.2.64/26"}
    assert metrics_client.post("/api/query", json=payload).status_code == 201


def test_prepare_metrics_dir_creates_temporary_dir(monkeypatch):
    monkeypatch.delenv("PROMETHEUS_MULTIPROC_DIR", raising=False)
    path = prepare_metrics_dir()
    try:
        assert path.is_dir()
        assert os.environ["PROMETHEUS_MULTIPROC_DIR"] == str(path)
        assert os.access(path, os.W_OK)
    finally:
        path.rmdir()


def test_prepare_metrics_dir_clears_stale_values(monkeypatch, tmp_path):
    (tmp_path / "counter_1234.db").write_bytes(b"stale")
    (tmp_path / "keep.txt").write_text("not ours")
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", str(tmp_path))

    assert prepare_metrics_dir() == tmp_path
    assert not (tmp_path / "counter_1234.db").exists()
    assert (tmp_path / "keep.txt").exists()


def test_prepare_metrics_dir_creates_configured_dir(monkeypatch, tmp_path):
    path = tmp_path / "metrics"
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", str(path))
    assert prepare_metrics_dir() == path
    assert path.is_dir()


@pytest.mark.parametrize("enable", [True, False])
def test_start_prepares_metrics_dir_only_when_enabled(monkeypatch, enable):
    # Project
    from hyperglass import main
    from hyperglass.state import use_state

    use_state().cache.set("params", Params(metrics={"enable": enable}))
    prepared = []
    monkeypatch.setattr(main, "prepare_metrics_dir", lambda: prepared.append(True))
    monkeypatch.setattr(main.Settings, "disable_ui", True)
    monkeypatch.setattr("hyperglass.plugins.register_all_plugins", lambda: None)
    monkeypatch.setattr(main.uvicorn, "run", lambda **_: None)

    main.start(log_level="INFO", workers=1)

    assert prepared == ([True] if enable else [])
