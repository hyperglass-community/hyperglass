"""Forced refresh of cached query results through `force` on `/api/query`."""

# Standard Library
import json
import asyncio
import threading

# Third Party
import pytest
from litestar.testing import create_test_client
from redis.exceptions import RedisError

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
        self.during = None

    async def __call__(self, data):
        """Return a new output for each execution, after an optional delay or error."""
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.during is not None:
            self.during()
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


def lease_key(key):
    redis = use_state().redis
    return redis.key(f"{key}.refresh")


def age_entry(key, seconds):
    """Make the cached entry's last run look `seconds` old, through its cooldown."""
    instance = use_state().redis.instance
    if seconds >= INTERVAL:
        instance.delete(lease_key(key))
    else:
        instance.set(lease_key(key), "cooldown", ex=INTERVAL - seconds)


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
    use_state().redis.instance.set(lease_key(key), "token", ex=params.request_timeout)

    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 1
    assert forced["cached"] is True
    # The run in progress starts a cooldown of the interval when it ends.
    assert forced["refresh_in"] == INTERVAL


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


def test_forced_query_runs_again_after_the_cooldown(client, device):
    client.post("/api/query", json=body())
    age_entry(cache_key(), INTERVAL + 1)
    first = client.post("/api/query", json=body(force=True)).json()
    early = client.post("/api/query", json=body(force=True)).json()
    age_entry(cache_key(), INTERVAL)

    again = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 3
    assert (first["cached"], early["cached"], again["cached"]) == (False, True, False)
    assert early["refresh_in"] == INTERVAL
    assert again["output"] == "output 3"


def test_lease_that_expires_mid_run_still_cools_down(client, device):
    client.post("/api/query", json=body())
    key = cache_key()
    age_entry(key, INTERVAL + 1)
    instance = use_state().redis.instance
    # The run outlives its lease, then fails.
    device.during = lambda: instance.delete(lease_key(key))
    device.error = DeviceTimeout(error=TimeoutError(), device=use_state().devices["test"])

    failed = client.post("/api/query", json=body(force=True))
    device.during = device.error = None
    retried = client.post("/api/query", json=body(force=True)).json()

    assert failed.status_code >= 400
    assert instance.get(lease_key(key)) == b"cooldown"
    assert 0 < instance.ttl(lease_key(key)) <= INTERVAL
    assert device.calls == 2
    assert retried["cached"] is True


def test_lease_outlives_the_device_deadline(client, device):
    timeout = use_state().params.request_timeout
    client.post("/api/query", json=body())
    key = cache_key()
    age_entry(key, INTERVAL + 1)
    seen = []
    device.during = lambda: seen.append(use_state().redis.instance.ttl(lease_key(key)))

    client.post("/api/query", json=body(force=True))

    # The device query is stopped at `request_timeout - 1`.
    assert seen and seen[0] > timeout


def test_entry_that_expires_during_a_forced_run_is_rewritten(client, device):
    client.post("/api/query", json=body())
    key = cache_key()
    age_entry(key, INTERVAL + 1)
    device.during = lambda: use_state().redis.delete(key)

    forced = client.post("/api/query", json=body(force=True)).json()
    after = client.post("/api/query", json=body()).json()

    assert forced["cached"] is False
    assert forced["output"] == "output 2"
    assert after["cached"] is True
    assert after["output"] == "output 2"
    assert forced["refresh_in"] == INTERVAL


def test_cooldown_failure_keeps_the_result(client, device, monkeypatch):
    client.post("/api/query", json=body())
    age_entry(cache_key(), INTERVAL + 1)
    instance = use_state().redis.instance

    def fail(*args, **kwargs):
        raise RedisError("unavailable")

    monkeypatch.setattr(instance, "eval", fail)

    forced = client.post("/api/query", json=body(force=True))

    assert forced.status_code == 201
    assert forced.json()["output"] == "output 2"
    # The result's own write still turns this request's lease into a cooldown.
    assert instance.get(lease_key(cache_key())) == b"cooldown"


def test_forced_query_right_after_a_run_serves_cached(client, device):
    first = client.post("/api/query", json=body()).json()
    forced = client.post("/api/query", json=body(force=True)).json()

    assert device.calls == 1
    assert (first["cached"], forced["cached"]) == (False, True)
    assert 0 < forced["refresh_in"] <= INTERVAL


def test_unforced_run_keeps_another_requests_lease(client, device):
    key = cache_key()
    instance = use_state().redis.instance
    # Another request's forced run holds the key while this query has no entry.
    instance.set(lease_key(key), "foreign", ex=60)

    response = client.post("/api/query", json=body()).json()

    assert device.calls == 1
    assert response["cached"] is False
    assert instance.get(lease_key(key)) == b"foreign"
    assert response["refresh_in"] == INTERVAL


def test_forced_run_keeps_a_lease_taken_after_its_own(client, device):
    client.post("/api/query", json=body())
    key = cache_key()
    age_entry(key, INTERVAL + 1)
    instance = use_state().redis.instance
    # This run's lease is replaced by another request's, as if it had expired.
    device.during = lambda: instance.set(lease_key(key), "foreign", ex=60)

    client.post("/api/query", json=body(force=True))

    assert device.calls == 2
    assert instance.get(lease_key(key)) == b"foreign"


def test_force_must_be_a_boolean(client, device):
    use_state().redis.set("params", Params())

    response = client.post("/api/query", json=body(force="sometimes"))

    assert response.status_code == 400
    assert device.calls == 0


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


@pytest.mark.parametrize("enable", [True, False])
def test_only_refresh_enable_is_sent_to_the_ui(enable):
    # Project
    from hyperglass.configuration.validate import init_ui_params

    params = Params(cache={"timeout": 60, "refresh": {"enable": enable, "min_interval": 20}})
    devices = Devices()

    exported = json.loads(init_ui_params(params=params, devices=devices).export_json(by_alias=True))

    # The UI needs `enable` to decide whether the requery button forces a refresh; the
    # interval reaches it as `refresh_in` on each response.
    assert exported["cache"] == {"timeout": 60, "showText": True, "refresh": {"enable": enable}}
