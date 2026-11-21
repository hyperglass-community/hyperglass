"""Forced refresh of cached query results through `force` on `/api/query`."""

# Standard Library
import time
import asyncio
import threading

# Third Party
import pytest
from litestar.testing import create_test_client

# Project
from hyperglass.state import use_state
from hyperglass.settings import Settings
from hyperglass.models.api import Query
from hyperglass.exceptions.public import DeviceTimeout
from hyperglass.models.config.params import Params
from hyperglass.models.config.devices import Devices

INTERVAL = 30
QUERY_TYPE = "__hyperglass_frr_bgp_route__"


def body(target="192.0.2.0/24", **extra):
    return {"queryLocation": "test", "queryType": QUERY_TYPE, "queryTarget": target, **extra}


def cache_key(target="192.0.2.0/24"):
    query = Query(queryLocation="test", queryType=QUERY_TYPE, queryTarget=target)
    return f"hyperglass.query.{query.digest()}"


class Device:
    """Stand-in for `_execute_query` that counts device executions."""

    def __init__(self) -> None:
        self.calls = 0
        self.delay = 0.0
        self.error = None

    async def __call__(self, data):
        """Return a new output for each execution, after an optional delay or error."""
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return f"output {self.calls}"


@pytest.fixture
def device(monkeypatch):
    monkeypatch.setattr(Settings, "disable_ui", True)
    # Project
    from hyperglass.api import routes

    state = use_state()
    state.redis.set(
        "params",
        Params(cache={"timeout": 120, "refresh": {"enable": True, "min_interval": INTERVAL}}),
    )
    state.redis.set(
        "devices",
        Devices(
            {
                "name": "test",
                "address": "192.0.2.1",
                "platform": "frr",
                "credential": {"username": "test", "password": "test"},
                "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
            }
        ),
    )
    stub = Device()
    monkeypatch.setattr(routes, "_execute_query", stub)
    return stub


@pytest.fixture
def client(device):
    # Project
    from hyperglass.api.routes import query

    with create_test_client([query]) as test_client:
        yield test_client


def age_entry(key, seconds):
    """Make the cached entry look as if it ran `seconds` ago."""
    use_state().redis.set_map_item(key, "executed_at", time.time() - seconds)


def test_digest_excludes_force(device):
    plain = Query(**body())
    forced = Query(**body(force=True))

    assert forced.force is True
    assert plain.force is False
    assert plain.digest() == forced.digest()


def test_unforced_queries_still_use_the_cache(client, device):
    first = client.post("/api/query", json=body()).json()
    age_entry(cache_key(), INTERVAL + 1)
    second = client.post("/api/query", json=body()).json()

    assert device.calls == 1
    assert (first["cached"], second["cached"]) == (False, True)
    assert second["output"] == "output 1"
    assert first["refresh_in"] == INTERVAL


def test_forced_query_reruns_and_replaces_the_entry(client, device):
    client.post("/api/query", json=body())
    key = cache_key()
    # A field the first run left behind must not survive the forced run.
    use_state().redis.set_map_item(key, "enrichment_generation", "old")
    age_entry(key, INTERVAL)

    forced = client.post("/api/query", json=body(force=True)).json()
    after = client.post("/api/query", json=body()).json()

    assert device.calls == 2
    assert forced["cached"] is False
    assert forced["output"] == "output 2"
    assert forced["refresh_in"] == INTERVAL
    assert after["output"] == "output 2"
    assert use_state().redis.get_map(key, "enrichment_generation") is None


@pytest.mark.parametrize("target", ("198.51.100.0/24", "2001:db8::/48"))
def test_forced_query_ip_versions(client, device, target):
    client.post("/api/query", json=body(target))
    age_entry(cache_key(target), INTERVAL + 1)

    forced = client.post("/api/query", json=body(target, force=True)).json()

    assert device.calls == 2
    assert forced["cached"] is False


def test_forced_query_within_interval_serves_cached(client, device):
    client.post("/api/query", json=body())
    age_entry(cache_key(), 10)

    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 1
    assert forced["cached"] is True
    assert forced["output"] == "output 1"
    assert forced["refresh_in"] == INTERVAL - 10


def test_forced_query_without_cached_entry_runs_once(client, device):
    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 1
    assert forced["cached"] is False


def test_lease_held_by_a_run_serves_cached(client, device):
    params = use_state().params
    client.post("/api/query", json=body())
    key = cache_key()
    age_entry(key, INTERVAL + 1)
    # Another worker's forced run of the same query is in progress.
    redis = use_state().redis
    redis.instance.set(redis.key(f"{key}.refresh"), "token", ex=params.request_timeout)

    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 1
    assert forced["cached"] is True
    # The run in progress, then the cooldown that follows it.
    assert INTERVAL < forced["refresh_in"] <= params.request_timeout + INTERVAL


def test_concurrent_forced_queries_run_once(client, device):
    client.post("/api/query", json=body())
    age_entry(cache_key(), INTERVAL + 1)
    device.delay = 0.5
    results = []

    def send():
        results.append(client.post("/api/query", json=body(force=True)).json())

    threads = [threading.Thread(target=send) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert device.calls == 2
    assert sorted(result["cached"] for result in results) == [False] + [True] * 4


def test_failed_forced_run_keeps_entry_and_cools_down(client, device):
    client.post("/api/query", json=body())
    age_entry(cache_key(), INTERVAL + 1)
    device.error = DeviceTimeout(error=TimeoutError(), device=use_state().devices["test"])

    failed = client.post("/api/query", json=body(force=True))
    device.error = None
    retried = client.post("/api/query", json=body(force=True)).json()

    assert failed.status_code >= 400
    # The failed run was the only one: the retry falls in its cooldown.
    assert device.calls == 2
    assert retried["cached"] is True
    assert retried["output"] == "output 1"
    assert 0 < retried["refresh_in"] <= INTERVAL


def test_forced_run_cools_down_for_the_interval(client, device):
    client.post("/api/query", json=body())
    age_entry(cache_key(), INTERVAL + 1)
    client.post("/api/query", json=body(force=True))
    # Even if the entry's own age says otherwise, the cooldown holds.
    age_entry(cache_key(), INTERVAL + 1)

    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 2
    assert forced["cached"] is True
    assert 0 < forced["refresh_in"] <= INTERVAL


def test_force_is_ignored_when_refresh_is_disabled(client, device):
    use_state().redis.set("params", Params())
    client.post("/api/query", json=body())
    age_entry(cache_key(), 100)

    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 1
    assert forced["cached"] is True
    assert forced["refresh_in"] is None


def test_refresh_is_off_by_default():
    refresh = Params().cache.refresh
    assert (refresh.enable, refresh.min_interval) == (False, 30)
    # A short timeout is fine while refresh is off.
    assert Params(cache={"timeout": 10}).cache.timeout == 10


@pytest.mark.parametrize("interval", (60, 61))
def test_refresh_interval_must_be_below_the_cache_timeout(interval):
    with pytest.raises(ValueError, match="min_interval"):
        Params(cache={"timeout": 60, "refresh": {"enable": True, "min_interval": interval}})


def test_refresh_interval_must_be_positive():
    with pytest.raises(ValueError):
        Params(cache={"refresh": {"enable": True, "min_interval": 0}})


def test_refresh_config_is_not_sent_to_the_ui():
    assert Params().frontend()["cache"] == {"show_text": True, "timeout": 120}
