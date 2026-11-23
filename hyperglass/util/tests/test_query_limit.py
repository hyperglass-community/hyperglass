"""Optional per-client and global rate limit on `POST /api/query` (#584)."""

# Standard Library
import typing as t

# Third Party
import pytest
from litestar import Request
from litestar.testing import create_test_client
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.exceptions import ResponseError
from redis.exceptions import ConnectionError as RedisConnectionError
from litestar.exceptions import HTTPException, ValidationException
from litestar.datastructures import Address

# Project
from hyperglass.state import use_state
from hyperglass.settings import Settings
from hyperglass.exceptions import HyperglassError
from hyperglass.models.config.params import Params
from hyperglass.models.config.devices import Devices
from hyperglass.util.tests.test_client_address import TRUSTED

QUERY_TYPE = "__hyperglass_frr_bgp_route__"
MESSAGE = "Slow down, please."
LIMIT = {"enable": True, "client_limit": 2, "global_limit": 5, "window": 45}


def body(target: str = "192.0.2.0/24") -> t.Dict[str, str]:
    return {"queryLocation": "test", "queryType": QUERY_TYPE, "queryTarget": target}


def peer(address: str) -> t.Type[Request]:
    """Build a request class whose socket peer is `address`."""

    class PeerRequest(Request):
        @property
        def client(self) -> Address:
            return Address(address, 1234)

    return PeerRequest


class Device:
    """Stand-in for `_execute_query` that counts device executions."""

    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, data: t.Any) -> str:
        """Return a new output for each execution."""
        self.calls += 1
        return f"output {self.calls}"


def configure(query_limit: t.Optional[t.Dict[str, t.Any]] = None, **params: t.Any) -> None:
    use_state().redis.set(
        "params",
        Params(
            query_limit=LIMIT if query_limit is None else query_limit,
            messages={"rate_limited": MESSAGE},
            **params,
        ),
    )


@pytest.fixture
def device(monkeypatch) -> Device:
    monkeypatch.setattr(Settings, "disable_ui", True)
    # Project
    from hyperglass.api import routes

    use_state().redis.set(
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
    configure()
    stub = Device()
    monkeypatch.setattr(routes, "_execute_query", stub)
    return stub


def client(address: str = "192.0.2.10", route: t.Any = None):
    """Build a test client for `route` (`/api/query`), with the app's error handlers."""
    # Project
    from hyperglass.api.routes import query
    from hyperglass.api.error_handlers import (
        app_handler,
        http_handler,
        default_handler,
        validation_handler,
    )

    return create_test_client(
        [route or query],
        request_class=peer(address),
        exception_handlers={
            HTTPException: http_handler,
            HyperglassError: app_handler,
            ValidationException: validation_handler,
            Exception: default_handler,
        },
    )


def statuses(test_client, count: int, **kwargs: t.Any) -> t.List[int]:
    """Send `count` distinct (uncached) queries and return their status codes."""
    return [
        test_client.post("/api/query", json=body(f"192.0.2.{index}"), **kwargs).status_code
        for index in range(count)
    ]


# Configuration


def test_defaults():
    limit = Params().query_limit
    assert (limit.enable, limit.client_limit, limit.global_limit, limit.window) == (
        False,
        30,
        300,
        60,
    )
    assert Params().messages.rate_limited


def test_limits_must_be_positive():
    for key in ("client_limit", "global_limit", "window"):
        with pytest.raises(ValueError):
            Params(query_limit={key: 0})


def test_window_is_bounded():
    assert Params(query_limit={"window": 2592000}).query_limit.window == 2592000
    with pytest.raises(ValueError):
        Params(query_limit={"window": 2592001})


def test_query_limit_is_not_sent_to_the_ui():
    assert "query_limit" not in Params(query_limit=LIMIT).frontend()


# Limits


def test_client_limit(device):
    with client() as test_client:
        assert statuses(test_client, 3) == [201, 201, 429]
    # The rejected query never reached the device.
    assert device.calls == 2
    with client("192.0.2.11") as test_client:
        assert statuses(test_client, 1) == [201]


def test_global_limit(device):
    results = []
    for index in range(6):
        with client(f"198.51.100.{index}") as test_client:
            response = test_client.post("/api/query", json=body(f"192.0.2.{index}"))
            results.append(response.status_code)
    assert results == [201] * 5 + [429]
    assert device.calls == 5


@pytest.mark.parametrize(
    "first,second,shared",
    (
        pytest.param("2001:db8:1:2::1", "2001:db8:1:2:ffff::9", True, id="same-64"),
        pytest.param("2001:db8:1:2::1", "2001:db8:1:3::1", False, id="other-64"),
        pytest.param("::ffff:192.0.2.1", "192.0.2.1", True, id="ipv4-mapped"),
        pytest.param("192.0.2.1", "192.0.2.2", False, id="other-ipv4"),
    ),
)
def test_client_identity(device, first, second, shared):
    with client(first) as test_client:
        assert statuses(test_client, 2) == [201, 201]
    with client(second) as test_client:
        assert statuses(test_client, 1) == [429 if shared else 201]


def test_trusted_proxy_forwarded_client(device):
    configure(web={"client_ip": TRUSTED})
    with client("10.0.0.2") as proxy:
        first = statuses(proxy, 3, headers={"X-Forwarded-For": "203.0.113.7"})
        second = statuses(proxy, 1, headers={"X-Forwarded-For": "2001:db8:5::1"})
    assert first == [201, 201, 429]
    # The proxy's own address is not the identity: another client behind it is not limited.
    assert second == [201]


def test_untrusted_forwarding_header_is_ignored(device):
    with client("203.0.113.9") as test_client:
        results = [
            test_client.post(
                "/api/query",
                json=body(f"192.0.2.{index}"),
                headers={"X-Forwarded-For": f"198.51.100.{index}"},
            ).status_code
            for index in range(3)
        ]
    # A client that is not a trusted proxy can't pick its identity with the header.
    assert results == [201, 201, 429]


def test_cached_answers_are_counted(device):
    with client() as test_client:
        first = test_client.post("/api/query", json=body())
        second = test_client.post("/api/query", json=body())
        third = test_client.post("/api/query", json=body())
    assert (first.json()["cached"], second.json()["cached"]) == (False, True)
    assert third.status_code == 429
    assert device.calls == 1


def test_validation_failures_are_not_counted(device):
    with client() as test_client:
        # A malformed body, an unknown location and an invalid target.
        rejected = [
            test_client.post("/api/query", json={"queryLocation": "test"}).status_code,
            test_client.post("/api/query", json={**body(), "queryLocation": "nowhere"}).status_code,
            test_client.post("/api/query", json=body("not a prefix")).status_code,
        ]
        accepted = statuses(test_client, 2)
    assert all(400 <= status < 500 and status != 429 for status in rejected)
    assert accepted == [201, 201]


def test_rejection_body_and_retry_after(device):
    with client() as test_client:
        statuses(test_client, 2)
        response = test_client.post("/api/query", json=body("2001:db8::/48"))
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "45"
    assert response.json() == {"output": MESSAGE, "level": "warning", "keywords": []}


def test_window_sets_counter_expiry(device):
    with client() as test_client:
        statuses(test_client, 1)
    instance = use_state("redis").instance
    keys = [key.decode() for key in instance.keys("*quota*query*")]
    assert len(keys) == 2
    assert all(0 < instance.ttl(key) <= 45 for key in keys)
    # The client address is hashed before it is used as a key.
    assert not any("192.0.2.10" in key for key in keys)


def test_disabled_makes_no_quota_calls(device, monkeypatch):
    configure(query_limit={"enable": False, "client_limit": 1, "global_limit": 1})
    instance = use_state("redis").instance

    def fail(*args, **kwargs):
        raise AssertionError("no quota call expected")

    monkeypatch.setattr(instance, "eval", fail)
    with client() as test_client:
        assert statuses(test_client, 3) == [201, 201, 201]


@pytest.mark.parametrize(
    "error", (RedisConnectionError("offline"), RedisTimeoutError("timed out")), ids=type
)
def test_redis_unreachable_lets_the_query_through(device, monkeypatch, error):
    def fail(*args, **kwargs):
        raise error

    monkeypatch.setattr(use_state("redis").instance, "eval", fail)
    with client() as test_client:
        assert statuses(test_client, 3) == [201, 201, 201]
    assert device.calls == 3


def test_other_redis_errors_are_not_swallowed(device, monkeypatch):
    def fail(*args, **kwargs):
        raise ResponseError("unknown command")

    monkeypatch.setattr(use_state("redis").instance, "eval", fail)
    with client() as test_client:
        response = test_client.post("/api/query", json=body())
    assert response.status_code == 500
    assert device.calls == 0


# Counter invariants of the shared quota script.


def counter_keys(address: str = "192.0.2.10") -> t.Tuple[str, str]:
    """Return the global and client counter keys of `/api/query` for `address`."""
    # Project
    from hyperglass.api import quota

    class Connection:
        client = Address(address, 1234)
        headers: t.Dict[str, str] = {}

    identity = quota.client_identity(Connection(), use_state("params").web.client_ip)
    return quota._key("query", "global"), quota._key("query", f"client:{identity}")


def test_client_identity_is_hashed_per_64():
    # Project
    from hyperglass.api.quota import client_identity

    class Connection:
        headers: t.Dict[str, str] = {}

        def __init__(self, address):
            self.client = Address(address, 1234)

    first = client_identity(Connection("2001:db8:1:2::1"))
    assert first == client_identity(Connection("2001:db8:1:2:ffff::9"))
    assert first != client_identity(Connection("2001:db8:1:3::1"))
    assert len(first) == 64 and "2001" not in first


def test_client_over_limit_leaves_global_counter_unchanged(device):
    global_key, _ = counter_keys()
    with client() as test_client:
        assert statuses(test_client, 4) == [201, 201, 429, 429]
    assert int(use_state("redis").instance.get(global_key)) == 2


def test_global_over_limit_creates_no_client_key(device):
    for index in range(6):
        with client(f"198.51.100.{index}") as test_client:
            test_client.post("/api/query", json=body(f"192.0.2.{index}"))
    instance = use_state("redis").instance
    assert instance.exists(counter_keys("198.51.100.4")[1]) == 1
    assert instance.exists(counter_keys("198.51.100.5")[1]) == 0
    assert int(instance.get(counter_keys()[0])) == 5


def test_later_requests_keep_the_counter_expiry(device):
    instance = use_state("redis").instance
    keys = counter_keys()
    with client() as test_client:
        statuses(test_client, 1)
        for key in keys:
            instance.expire(key, 10)
        test_client.post("/api/query", json=body("198.51.100.0/24"))
    assert all(0 < instance.ttl(key) <= 10 for key in keys)


def test_counter_without_expiry_gets_one(device):
    instance = use_state("redis").instance
    global_key, client_key = counter_keys()
    instance.set(global_key, 1)
    instance.set(client_key, 1)
    with client() as test_client:
        assert statuses(test_client, 1) == [201]
    assert all(0 < instance.ttl(key) <= 45 for key in (global_key, client_key))


def test_rejected_query_does_not_read_the_cache(device, monkeypatch):
    # Project
    from hyperglass.state.redis import RedisManager

    with client() as test_client:
        statuses(test_client, 2)

        def no_cache(*args, **kwargs):
            raise AssertionError("the cache was read before the limit was checked")

        monkeypatch.setattr(RedisManager, "get_map", no_cache)
        response = test_client.post("/api/query", json=body())
    assert response.status_code == 429


# Server lookups keep their quota behaviour.


def test_lookup_quota_unchanged(monkeypatch):
    # Standard Library
    from unittest.mock import AsyncMock

    # Project
    from hyperglass.api import auxiliary
    from hyperglass.api.routes import aspath_enrich

    monkeypatch.setattr(
        auxiliary, "_asn_query", AsyncMock(return_value={"13335": {"name": "x", "country": ""}})
    )
    use_state().redis.set(
        "params",
        Params(
            web={"aspath_enrichment": True, "server_lookups": {"aspath": {"client_limit": 1}}},
            query_limit=LIMIT,
        ),
    )
    with client(route=aspath_enrich) as test_client:
        first = test_client.post("/api/aspath/enrich", json={"as_path": [13335]})
        second = test_client.post("/api/aspath/enrich", json={"as_path": [13335]})
    assert first.status_code == 201
    assert second.status_code == 429
    # What clients get through the app's `http_handler`: the detail as `output`, and
    # the `Retry-After` header (#585).
    assert second.json() == {
        "output": "Lookup rate limit exceeded",
        "level": "danger",
        "keywords": [],
    }
    assert second.headers["Retry-After"] == "60"
    instance = use_state("redis").instance
    keys = [key.decode() for key in instance.keys("*quota*aspath*")]
    assert len(keys) == 2
    assert all(55 < instance.ttl(key) <= 60 for key in keys)
