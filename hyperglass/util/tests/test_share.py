"""Share snapshots: storage, configuration and API (#559)."""

# Standard Library
import json
import typing as t

# Third Party
import pytest
import fakeredis
from litestar import Request
from litestar.testing import TestClient, create_test_client
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import OutOfMemoryError
from litestar.exceptions import HTTPException, ValidationException
from litestar.datastructures import Address

# Project
from hyperglass.log import log
from hyperglass.state import use_state
from hyperglass.settings import Settings
from hyperglass.exceptions import HyperglassError
from hyperglass.state.hooks import _use_state
from hyperglass.models.directive import Directives
from hyperglass.defaults.directives import init_builtin_directives
from hyperglass.models.config.params import Params
from hyperglass.models.config.devices import Devices

QUERY_TYPE = "__hyperglass_frr_bgp_route__"
PRIVATE = "private_route"
CLIENT = "192.0.2.10"
SHARE = {"enable": True}
DELETE_HEADER = "X-Delete-Token"
MESSAGES = {
    "share_result_expired": "Run it again.",
    "share_pending": "Still enriching.",
    "share_not_allowed": "Not shareable.",
    "share_too_large": "Too large.",
    "share_unavailable": "Sharing is full.",
    "share_not_found": "No such share.",
    "share_unsupported": "Unsupported share.",
    "share_invalid_expiry": "Pick an offered time.",
    "rate_limited": "Slow down.",
}


def body(target: str = "192.0.2.0/24", query_type: str = QUERY_TYPE) -> t.Dict[str, str]:
    return {"queryLocation": "test", "queryType": query_type, "queryTarget": target}


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
        self.output: t.Optional[str] = None

    async def __call__(self, data: t.Any) -> str:
        """Return the set output, or a new output for each execution."""
        self.calls += 1
        return self.output if self.output is not None else f"output {self.calls}"


def private_directive(retain: bool = True) -> t.Dict[str, t.Any]:
    return {
        PRIVATE: {
            "name": "Private Route",
            "retain": retain,
            "rules": [
                {"condition": "0.0.0.0/0", "command": "show route {target}"},
                {"condition": "::/0", "command": "show route {target}"},
            ],
            "field": {"description": "IP address or prefix"},
        }
    }


def configure_devices(*, retain: bool = True, private: bool = True) -> None:
    """Store the directives and one FRR device, as a start with this config would."""
    state = use_state()
    directives = init_builtin_directives()
    if private:
        directives = Directives(*directives, *Directives.new(private_directive(retain)))
    state.redis.set("directives", directives)
    # `use_state("directives")`, which builds the devices, keeps the first value it read.
    _use_state.cache_clear()
    state.redis.set(
        "devices",
        Devices(
            {
                "name": "test",
                "address": "192.0.2.1",
                "platform": "frr",
                "credential": {"username": "test", "password": "test"},
                "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
                "directives": [PRIVATE] if private else [],
            }
        ),
    )


def configure(share: t.Optional[t.Dict[str, t.Any]] = None, **params: t.Any) -> None:
    use_state().redis.set(
        "params",
        Params(share={**SHARE, **(share or {})}, messages=MESSAGES, **params),
    )


@pytest.fixture
def device(monkeypatch) -> Device:
    monkeypatch.setattr(Settings, "disable_ui", True)
    # Project
    from hyperglass.api import routes

    configure_devices()
    configure()
    stub = Device()
    monkeypatch.setattr(routes, "_execute_query", stub)
    return stub


def client(address: str = CLIENT) -> TestClient:
    """Build a test client for the query and share routes, with the app's error handlers."""
    # Project
    from hyperglass.api.share import share_read, share_create, share_delete
    from hyperglass.api.routes import query
    from hyperglass.api.error_handlers import (
        app_handler,
        http_handler,
        default_handler,
        validation_handler,
    )

    return create_test_client(
        [query, share_create, share_read, share_delete],
        request_class=peer(address),
        exception_handlers={
            HTTPException: http_handler,
            HyperglassError: app_handler,
            ValidationException: validation_handler,
            Exception: default_handler,
        },
    )


def run_query(test_client: TestClient, target: str = "192.0.2.0/24", **kwargs: t.Any) -> str:
    response = test_client.post("/api/query", json={**body(target, **kwargs)})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create(test_client: TestClient, query_id: str, **extra: t.Any):
    return test_client.post("/api/share", json={"queryId": query_id, **extra})


def shared(test_client: TestClient, target: str = "192.0.2.0/24", **kwargs: t.Any) -> t.Dict:
    """Run a query and share its result; return the share response body."""
    response = create(test_client, run_query(test_client, target, **kwargs))
    assert response.status_code == 201, response.text
    return response.json()


def raw() -> fakeredis.FakeRedis:
    return use_state().redis.instance


def stored(share_id: str) -> t.Dict[bytes, bytes]:
    return raw().hgetall(f"hyperglass.share:{share_id}")


def snapshot(share_id: str) -> t.Dict[str, t.Any]:
    return json.loads(stored(share_id)[b"snapshot"])


def index() -> t.List[bytes]:
    return raw().zrange("hyperglass.share:index", 0, -1)


# Configuration


def test_defaults():
    share = Params().share
    assert share.enable is False
    assert (share.timeout, share.max_timeout) == (2592000, 7776000)
    assert share.timeout_choices == [604800, 2592000, 7776000]
    assert (share.max_entries, share.max_size) == (1000, 262144)
    assert (share.quota.client_limit, share.quota.global_limit, share.quota.window) == (
        10,
        100,
        3600,
    )
    read = share.read_quota
    assert (read.client_limit, read.global_limit, read.window) == (60, 1200, 60)
    for key in MESSAGES:
        assert getattr(Params().messages, key)


DAY = 86400


@pytest.mark.parametrize(
    ("config", "choices"),
    (
        ({}, [7 * DAY, 30 * DAY, 90 * DAY]),
        # Choices above the cap are dropped.
        ({"max_timeout": 30 * DAY}, [7 * DAY, 30 * DAY]),
        (
            {"max_timeout": 365 * DAY, "timeout_choices": [365 * DAY, 30 * DAY]},
            [30 * DAY, 365 * DAY],
        ),
        ({"timeout": 60, "timeout_choices": [60, 30 * DAY, 30 * DAY]}, [60, 30 * DAY]),
    ),
)
def test_timeout_choices(config, choices):
    assert Params(share=config).share.timeout_choices == choices


@pytest.mark.parametrize(
    "config",
    (
        # The default must be one of the offered times, after the cap.
        {"timeout": 14 * DAY},
        {"max_timeout": 7 * DAY},
        # Nothing left after the cap.
        {"max_timeout": DAY, "timeout": DAY, "timeout_choices": [7 * DAY]},
        {"timeout_choices": []},
        {"max_timeout": 365 * DAY + 1},
        {"timeout": 59, "timeout_choices": [59]},
        {"timeout_choices": [30 * DAY, 0]},
        {"timeout_choices": [30 * DAY, 365 * DAY + 1], "max_timeout": 365 * DAY},
    ),
)
def test_invalid_timeouts(config):
    with pytest.raises(ValueError):
        Params(share=config)


@pytest.mark.parametrize(
    "key",
    ("max_entries", "max_size", "quota.client_limit", "quota.window", "read_quota.global_limit"),
)
def test_limits_must_be_positive(key):
    *parents, name = key.split(".")
    value: t.Dict[str, t.Any] = {name: 0}
    for parent in reversed(parents):
        value = {parent: value}
    with pytest.raises(ValueError):
        Params(share=value)


def test_only_enable_and_the_timeouts_are_sent_to_the_ui():
    """The Share button (#561) needs to know whether sharing is on; nothing else is sent."""
    share = Params(share={"enable": True, "max_timeout": 30 * DAY}).frontend()["share"]
    assert share == {"enable": True, "timeout": 30 * DAY, "timeout_choices": [7 * DAY, 30 * DAY]}
    assert Params().frontend()["share"]["enable"] is False


def test_ui_parameters_carry_enable_and_the_timeouts():
    # Project
    from hyperglass.models.ui import UIParameters

    assert UIParameters.model_fields["share"].annotation.model_fields.keys() == {
        "enable",
        "timeout",
        "timeout_choices",
    }


def test_max_size_default_fits_large_structured_results():
    """The largest structured BGP fixture, 53 routes, is far below the default `max_size`."""
    # Project
    from hyperglass.plugins.tests.test_bgp_route_bird import _process

    table = _process("aspath4.txt")
    assert table.count == 53
    assert len(table.export_json().encode()) * 10 < Params().share.max_size


# Creating a share


def test_create_and_read(device):
    with client() as test_client:
        query_id = run_query(test_client)
        response = create(test_client, query_id)
        assert response.status_code == 201
        created = response.json()
        assert set(created) == {"id", "expiresAt", "deleteToken"}
        assert len(created["id"]) == 32 and int(created["id"], 16) >= 0
        assert len(created["deleteToken"]) >= 32

        read = test_client.get(f"/api/share/{created['id']}")
    assert read.status_code == 200
    assert read.headers["cache-control"] == "no-store"
    assert read.headers["x-robots-tag"] == "noindex"
    data = read.json()
    assert set(data) == {"id", "version", "createdAt", "expiresAt", "results"}
    assert data["id"] == created["id"]
    assert data["version"] == 1
    assert data["expiresAt"] == created["expiresAt"]
    (result,) = data["results"]
    assert result["output"] == "output 1"
    assert result["format"] == "text/plain"
    assert result["query"] == {
        "location": "test",
        "queryType": QUERY_TYPE,
        "queryTypeName": "BGP Route",
        "target": "192.0.2.0/24",
        "variables": {},
    }
    assert result["labels"] == {"location": "test", "queryType": "BGP Route"}
    assert isinstance(result["runtime"], int)
    assert result["timestamp"]
    assert device.calls == 1


def test_share_of_ipv6_target(device):
    with client() as test_client:
        created = shared(test_client, "2001:db8::/32")
        data = test_client.get(f"/api/share/{created['id']}").json()
    assert data["results"][0]["query"]["target"] == "2001:db8::/32"


def test_only_allowlisted_fields_are_stored(device):
    with client() as test_client:
        created = shared(test_client)
    fields = stored(created["id"])
    assert set(fields) == {b"snapshot", b"token"}
    data = snapshot(created["id"])
    assert set(data) == {"version", "createdAt", "expiresAt", "results"}
    (result,) = data["results"]
    assert set(result) == {"query", "labels", "output", "format", "timestamp", "runtime"}
    assert set(result["query"]) == {"location", "queryType", "queryTypeName", "target", "variables"}
    assert set(result["labels"]) == {"location", "queryType"}
    text = b"".join(fields.values()).decode()
    assert CLIENT not in text
    assert created["deleteToken"] not in text
    # Standard Library
    import hashlib

    # Project
    from hyperglass.api.quota import quota_identity

    assert hashlib.sha256(quota_identity(CLIENT).encode()).hexdigest() not in text


def test_cache_entry_carries_the_result_metadata(device):
    """The query cache entry holds what a share copies, so it copies only server data."""
    with client() as test_client:
        query_id = run_query(test_client, "2001:db8::/32")
    cache = use_state().redis
    assert cache.get_map(query_id, "query") == {
        "location": "test",
        "query_type": QUERY_TYPE,
        "query_type_name": "BGP Route",
        "target": "2001:db8::/32",
        "variables": {},
    }
    assert cache.get_map(query_id, "labels") == {"location": "test", "query_type": "BGP Route"}
    assert cache.get_map(query_id, "format") == "text/plain"
    assert isinstance(cache.get_map(query_id, "runtime"), int)
    assert len(cache.get_map(query_id, "result_id")) == 32


def test_shared_target_is_the_validated_one(device, monkeypatch):
    """The target as validated is shared, not the one input plugins rewrote for the device."""
    # Project
    from hyperglass.models.api import Query

    monkeypatch.setattr(Query, "transform_query_target", lambda self: "rewritten")
    with client() as test_client:
        created = shared(test_client, "2001:db8::/32")
        data = test_client.get(f"/api/share/{created['id']}").json()
    assert data["results"][0]["query"]["target"] == "2001:db8::/32"


def test_expired_result_is_404(device):
    with client() as test_client:
        query_id = run_query(test_client)
        use_state().redis.delete(query_id)
        response = create(test_client, query_id)
    assert response.status_code == 404
    assert response.json()["output"] == MESSAGES["share_result_expired"]
    assert index() == []


def test_unknown_query_is_404(device):
    with client() as test_client:
        response = create(test_client, "hyperglass.query." + "0" * 64)
    assert response.status_code == 404


@pytest.mark.parametrize(
    "payload",
    (
        {"queryId": "hyperglass.state.params"},
        {"queryId": "hyperglass.query." + "0" * 63},
        {"queryId": "hyperglass.query." + "0" * 64, "extra": 1},
        {},
    ),
)
def test_malformed_request_is_400(device, payload):
    with client() as test_client:
        response = test_client.post("/api/share", json=payload)
    assert response.status_code == 400


def test_pending_enrichment_is_409(device):
    with client() as test_client:
        query_id = run_query(test_client)
        use_state().redis.set_map_item(query_id, "enrichment_status", "pending")
        response = create(test_client, query_id)
        assert response.status_code == 409
        assert response.json()["output"] == MESSAGES["share_pending"]
        use_state().redis.set_map_item(query_id, "enrichment_status", "failed")
        assert create(test_client, query_id).status_code == 201


def test_retain_false_is_403(device):
    configure_devices(retain=False)
    with client() as test_client:
        query_id = run_query(test_client, query_type=PRIVATE)
        response = create(test_client, query_id)
    assert response.status_code == 403
    assert response.json()["output"] == MESSAGES["share_not_allowed"]
    assert index() == []


def test_retained_custom_directive_can_be_shared(device):
    with client() as test_client:
        created = shared(test_client, query_type=PRIVATE)
        data = test_client.get(f"/api/share/{created['id']}").json()
    assert data["results"][0]["query"]["queryType"] == PRIVATE
    assert data["results"][0]["labels"]["queryType"] == "Private Route"


def test_max_size(device):
    with client() as test_client:
        query_id = run_query(test_client)
        size = len(stored(shared(test_client)["id"])[b"snapshot"])

    configure({"max_size": size})
    with client("192.0.2.11") as test_client:
        assert create(test_client, query_id).status_code == 201

    configure({"max_size": size - 1})
    with client("192.0.2.12") as test_client:
        response = create(test_client, query_id)
    assert response.status_code == 413
    assert response.json()["output"] == MESSAGES["share_too_large"]
    assert len(index()) == 2


def test_max_entries_without_eviction(device):
    configure({"max_entries": 2})
    ids = []
    for index_, address in enumerate(("192.0.2.10", "192.0.2.11")):
        with client(address) as test_client:
            ids.append(shared(test_client, f"192.0.2.{index_}")["id"])
    with client("192.0.2.12") as test_client:
        response = create(test_client, run_query(test_client, "198.51.100.0/24"))
        assert response.status_code == 503
        assert response.json()["output"] == MESSAGES["share_unavailable"]
        for share_id in ids:
            assert test_client.get(f"/api/share/{share_id}").status_code == 200
    assert sorted(index()) == sorted(i.encode() for i in ids)


def test_expired_shares_free_their_place(device):
    configure({"max_entries": 1})
    with client() as test_client:
        first = shared(test_client)["id"]
        query_id = run_query(test_client, "198.51.100.0/24")
        assert create(test_client, query_id).status_code == 503
        # The first share expired: Redis deleted it, its index score is in the past.
        raw().delete(f"hyperglass.share:{first}")
        raw().zadd("hyperglass.share:index", {first: 1})
        assert create(test_client, query_id).status_code == 201
    assert first.encode() not in index()


@pytest.mark.parametrize("seconds", (7 * DAY, 30 * DAY, 90 * DAY, "absent", None))
def test_expiry_is_the_chosen_time(device, seconds):
    # Absent or null: `share.timeout`.
    extra = {} if seconds == "absent" else {"expiresIn": seconds}
    expected = seconds if isinstance(seconds, int) else 30 * DAY
    with client() as test_client:
        response = create(test_client, run_query(test_client), **extra)
        assert response.status_code == 201
        created = response.json()
        data = test_client.get(f"/api/share/{created['id']}").json()
    key = f"hyperglass.share:{created['id']}"
    assert expected - 10 < raw().ttl(key) <= expected
    now = raw().time()[0]
    score = raw().zscore("hyperglass.share:index", created["id"])
    assert now + expected - 10 < score <= now + expected
    # Standard Library
    from datetime import datetime

    created_at = datetime.fromisoformat(data["createdAt"])
    expires_at = datetime.fromisoformat(data["expiresAt"])
    assert (expires_at - created_at).total_seconds() == expected
    assert data["expiresAt"] == created["expiresAt"]


@pytest.mark.parametrize("seconds", (3600, 14 * DAY, 365 * DAY, 0, -1, "604800", True, 604800.0))
def test_expiry_not_offered_is_400(device, seconds):
    with client() as test_client:
        response = create(test_client, run_query(test_client), expiresIn=seconds)
    assert response.status_code == 400
    assert index() == []


def test_expiry_not_offered_has_the_configured_text(device):
    with client() as test_client:
        response = create(test_client, run_query(test_client), expiresIn=3600)
    assert response.json()["output"] == MESSAGES["share_invalid_expiry"]
    assert response.headers["cache-control"] == "no-store"


def test_expiry_above_the_cap_is_400(device):
    configure({"max_timeout": 30 * DAY})
    with client() as test_client:
        query_id = run_query(test_client)
        refused = create(test_client, query_id, expiresIn=90 * DAY)
        accepted = create(test_client, query_id, expiresIn=30 * DAY)
    assert (refused.status_code, accepted.status_code) == (400, 201)


def test_reshare_keeps_the_expiry(device):
    with client() as test_client:
        query_id = run_query(test_client)
        first = create(test_client, query_id, expiresIn=7 * DAY).json()
        again = create(test_client, query_id, expiresIn=90 * DAY)
    assert again.status_code == 200
    assert again.json()["id"] == first["id"]
    assert again.json()["expiresAt"] == first["expiresAt"]
    assert raw().ttl(f"hyperglass.share:{first['id']}") <= 7 * DAY


def test_index_pruning_with_mixed_expiries(device):
    configure({"max_entries": 2})
    with client() as test_client:
        short = create(test_client, run_query(test_client), expiresIn=7 * DAY).json()["id"]
        long = create(
            test_client, run_query(test_client, "198.51.100.0/24"), expiresIn=90 * DAY
        ).json()["id"]
        scores = {
            member.decode(): score
            for member, score in raw().zrange("hyperglass.share:index", 0, -1, withscores=True)
        }
        assert scores[long] - scores[short] == 83 * DAY
        query_id = run_query(test_client, "203.0.113.0/24")
        assert create(test_client, query_id).status_code == 503
        # Eight days later: the 7-day share expired, the 90-day one is still live.
        raw().delete(f"hyperglass.share:{short}")
        raw().zadd("hyperglass.share:index", {short: raw().time()[0] - DAY})
        third = create(test_client, query_id)
    assert third.status_code == 201
    assert sorted(index()) == sorted([long.encode(), third.json()["id"].encode()])


def test_reading_does_not_extend_the_ttl(device):
    with client() as test_client:
        created = shared(test_client)
        key = f"hyperglass.share:{created['id']}"
        raw().expire(key, 100)
        test_client.get(f"/api/share/{created['id']}")
    assert raw().ttl(key) <= 100


def test_same_client_same_result_same_id(device):
    with client() as test_client:
        query_id = run_query(test_client)
        first = create(test_client, query_id).json()
        again = create(test_client, query_id)
        assert again.status_code == 200
        second = again.json()
        assert second["id"] == first["id"]
        assert second["expiresAt"] == first["expiresAt"]
        # The token is replaced: the latest response can always delete the share.
        assert second["deleteToken"] != first["deleteToken"]
        assert (
            test_client.delete(
                f"/api/share/{first['id']}", headers={DELETE_HEADER: first["deleteToken"]}
            ).status_code
            == 404
        )
    assert len(index()) == 1

    with client("2001:db8:1:2::7") as other:
        assert create(other, query_id).json()["id"] != first["id"]
    assert len(index()) == 2


def test_same_client_after_delete_gets_a_new_id(device):
    with client() as test_client:
        query_id = run_query(test_client)
        first = create(test_client, query_id).json()
        test_client.delete(
            f"/api/share/{first['id']}", headers={DELETE_HEADER: first["deleteToken"]}
        )
        second = create(test_client, query_id)
    assert second.status_code == 201
    assert second.json()["id"] != first["id"]


def test_refreshed_result_gets_a_new_id(device):
    configure(cache={"timeout": 120, "refresh": {"enable": True, "min_interval": 30}})
    with client() as test_client:
        query_id = run_query(test_client)
        first = create(test_client, query_id).json()
        # End the cooldown, then force a new run of the query (F1, #552).
        raw().delete(use_state().redis.key(f"{query_id}.refresh"))
        response = test_client.post("/api/query", json={**body(), "force": True})
        assert response.json()["output"] == "output 2"
        second = create(test_client, query_id)
        assert second.status_code == 201
        assert second.json()["id"] != first["id"]
        assert test_client.get(f"/api/share/{first['id']}").json()["results"][0]["output"] == (
            "output 1"
        )
        assert test_client.get(f"/api/share/{second.json()['id']}").json()["results"][0][
            "output"
        ] == ("output 2")


def test_result_rewritten_in_place_gets_a_new_id(device):
    """A new result written over the old one's entry, without deleting it, is a new share."""
    with client() as test_client:
        query_id = run_query(test_client)
        first = create(test_client, query_id).json()
        cache = use_state().redis
        # What `POST /api/query` writes for a new result, over the existing fields.
        cache.set_map_item(query_id, "output", "output 2")
        cache.set_map_item(query_id, "result_id", "e" * 32)
        second = create(test_client, query_id)
        assert second.status_code == 201
        assert second.json()["id"] != first["id"]
        output = test_client.get(f"/api/share/{second.json()['id']}").json()["results"][0]
    assert output["output"] == "output 2"


def test_result_replaced_while_sharing_is_not_shared(device, monkeypatch):
    """A share is created only from the result it copied, not from a newer one."""
    # Project
    from hyperglass import share as storage

    real = storage.read_cached_result

    def replaced(*args: t.Any, **kwargs: t.Any):
        result = real(*args, **kwargs)
        use_state().redis.set_map_item(args[1], "result_id", "f" * 32)
        return result

    monkeypatch.setattr(storage, "read_cached_result", replaced)
    with client() as test_client:
        response = create(test_client, run_query(test_client))
    assert response.status_code == 404
    assert index() == []


def test_share_of_the_result_with_its_timestamp(device):
    """A request naming the result's `timestamp` shares that result (#562)."""
    with client() as test_client:
        response = test_client.post("/api/query", json=body())
        data = response.json()
        created = create(test_client, data["id"], timestamp=data["timestamp"])
        assert created.status_code == 201, created.text
        shared_result = test_client.get(f"/api/share/{created.json()['id']}").json()
    assert shared_result["results"][0]["timestamp"] == data["timestamp"]


def test_newer_result_than_the_timestamp_is_not_shared(device):
    """A saved result whose query has run again since is gone: a newer one isn't shared.

    A history entry (#562) keeps the response's `id`, which names the query's cache entry,
    not the result. Once the query has run again, that entry holds another result.
    """
    with client() as test_client:
        data = test_client.post("/api/query", json=body()).json()
        # The query ran again later: a new result in the same cache entry.
        use_state().redis.set_map_item(data["id"], "timestamp", "2099-01-01 00:00:00")
        response = create(test_client, data["id"], timestamp=data["timestamp"])
    assert response.status_code == 404
    assert response.json()["output"] == MESSAGES["share_result_expired"]
    assert index() == []


def test_timestamp_is_optional(device):
    with client() as test_client:
        query_id = run_query(test_client)
        use_state().redis.set_map_item(query_id, "timestamp", "2099-01-01 00:00:00")
        response = create(test_client, query_id)
    assert response.status_code == 201


@pytest.mark.parametrize("timestamp", (20261123, "", "x" * 65, True, ["2026-11-23 08:00:00"]))
def test_malformed_timestamp_is_400(device, timestamp):
    with client() as test_client:
        query_id = run_query(test_client)
        response = create(test_client, query_id, timestamp=timestamp)
    assert response.status_code == 400
    assert index() == []


def test_share_survives_a_restart(device):
    with client() as test_client:
        created = shared(test_client)
    state = use_state()
    state.clear()
    assert state.redis.get("params") is None
    configure_devices()
    configure()
    with client() as test_client:
        assert test_client.get(f"/api/share/{created['id']}").status_code == 200


def test_structured_output_is_shared(device):
    device.output = None
    with client() as test_client:
        query_id = run_query(test_client)
        cache = use_state().redis
        cache.set_map_item(query_id, "output", {"vrf": "default", "routes": []})
        cache.set_map_item(query_id, "format", "application/json")
        created = create(test_client, query_id).json()
        data = test_client.get(f"/api/share/{created['id']}").json()
    assert data["results"][0]["output"] == {"vrf": "default", "routes": []}
    assert data["results"][0]["format"] == "application/json"


# Quotas


def test_client_quota(device):
    configure({"quota": {"client_limit": 2, "global_limit": 10, "window": 900}})
    with client() as test_client:
        statuses = [
            create(test_client, run_query(test_client, f"192.0.2.{i}")).status_code
            for i in range(3)
        ]
        response = create(test_client, run_query(test_client, "192.0.2.9"))
    assert statuses == [201, 201, 429]
    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"
    assert response.json()["output"] == MESSAGES["rate_limited"]
    with client("192.0.2.99") as other:
        assert create(other, run_query(other, "192.0.2.9")).status_code == 201


def test_global_quota(device):
    configure({"quota": {"client_limit": 5, "global_limit": 3, "window": 900}})
    statuses = []
    for i in range(4):
        with client(f"192.0.2.{20 + i}") as test_client:
            statuses.append(create(test_client, run_query(test_client, f"192.0.2.{i}")).status_code)
    assert statuses == [201, 201, 201, 429]


@pytest.mark.parametrize(
    ("first", "second", "shared_quota"),
    (
        ("2001:db8:1:2::1", "2001:db8:1:2:ffff::9", True),
        ("2001:db8:1:2::1", "2001:db8:1:3::1", False),
        ("::ffff:192.0.2.1", "192.0.2.1", True),
        ("192.0.2.1", "192.0.2.2", False),
    ),
)
def test_quota_identity_ipv6_per_64(device, first, second, shared_quota):
    configure({"quota": {"client_limit": 1, "global_limit": 10, "window": 900}})
    with client(first) as test_client:
        assert create(test_client, run_query(test_client, "192.0.2.0/24")).status_code == 201
    with client(second) as test_client:
        status = create(test_client, run_query(test_client, "198.51.100.0/24")).status_code
    assert status == (429 if shared_quota else 201)


def test_rejected_share_reads_no_cache_entry(device, monkeypatch):
    configure({"quota": {"client_limit": 1, "global_limit": 10, "window": 900}})
    # Project
    from hyperglass import share as storage

    with client() as test_client:
        query_id = run_query(test_client)
        assert create(test_client, query_id).status_code == 201

        def fail(*_: t.Any, **__: t.Any) -> None:
            raise AssertionError("read the cache entry over the quota")

        monkeypatch.setattr(storage, "read_cached_result", fail)
        assert create(test_client, query_id).status_code == 429


def test_read_quota(device):
    configure({"read_quota": {"client_limit": 2, "global_limit": 100, "window": 30}})
    with client() as test_client:
        share_id = shared(test_client)["id"]
        statuses = [test_client.get(f"/api/share/{share_id}").status_code for _ in range(3)]
        response = test_client.get(f"/api/share/{share_id}")
    assert statuses == [200, 200, 429]
    assert response.headers["retry-after"] == "30"
    with client("2001:db8:1:2::1") as other:
        assert other.get(f"/api/share/{share_id}").status_code == 200
        assert other.get(f"/api/share/{share_id}").status_code == 200
    with client("2001:db8:1:2::2") as same_64:
        assert same_64.get(f"/api/share/{share_id}").status_code == 429


# Reading a share


@pytest.mark.parametrize("share_id", ("0" * 32, "abc", "0" * 31 + "G", "0" * 33))
def test_unknown_share_is_404(device, share_id):
    with client() as test_client:
        response = test_client.get(f"/api/share/{share_id}")
    assert response.status_code == 404
    assert response.json()["output"] == MESSAGES["share_not_found"]


def tamper(share_id: str, data: t.Any) -> None:
    raw().hset(f"hyperglass.share:{share_id}", "snapshot", data)


@pytest.mark.parametrize(
    "change",
    (
        lambda data: "{not json",
        lambda data: json.dumps([data]),
        lambda data: json.dumps({**data, "extra": 1}),
        lambda data: json.dumps({**data, "version": "1"}),
        lambda data: json.dumps({**data, "results": []}),
        lambda data: json.dumps({**data, "results": [{**data["results"][0], "client": CLIENT}]}),
        lambda data: json.dumps(
            {**data, "results": [{**data["results"][0], "format": "application/json"}]}
        ),
        lambda data: json.dumps(
            {**data, "results": [{**data["results"][0], "format": "text/html"}]}
        ),
        lambda data: json.dumps({**data, "results": [{**data["results"][0], "runtime": "3"}]}),
    ),
    ids=(
        "bad-json",
        "not-an-object",
        "extra-field",
        "version-string",
        "no-results",
        "extra-result-field",
        "format-mismatch",
        "unknown-format",
        # Only strict validation refuses this: lax mode would read "3" as 3.
        "runtime-string",
    ),
)
def test_tampered_snapshot_is_not_served(device, change):
    with client() as test_client:
        share_id = shared(test_client)["id"]
        tamper(share_id, change(snapshot(share_id)))
        response = test_client.get(f"/api/share/{share_id}")
    assert response.status_code == 404
    assert response.json()["output"] == MESSAGES["share_not_found"]
    assert "output 1" not in response.text


def test_invalid_token_hash_is_not_served(device):
    with client() as test_client:
        share_id = shared(test_client)["id"]
        raw().hset(f"hyperglass.share:{share_id}", "token", "nope")
        assert test_client.get(f"/api/share/{share_id}").status_code == 404


@pytest.mark.parametrize("version", (0, 2, 99))
def test_unknown_version_is_not_served(device, version):
    with client() as test_client:
        share_id = shared(test_client)["id"]
        tamper(share_id, json.dumps({**snapshot(share_id), "version": version}))
        response = test_client.get(f"/api/share/{share_id}")
    assert response.status_code == 422
    assert response.json()["output"] == MESSAGES["share_unsupported"]
    assert "output 1" not in response.text


def test_directive_later_set_to_retain_false_is_404(device):
    with client() as test_client:
        share_id = shared(test_client, query_type=PRIVATE)["id"]
        assert test_client.get(f"/api/share/{share_id}").status_code == 200
        configure_devices(retain=False)
        response = test_client.get(f"/api/share/{share_id}")
    assert response.status_code == 404
    assert "output 1" not in response.text
    # The snapshot is kept: setting `retain: true` again serves it.
    configure_devices(retain=True)
    with client() as test_client:
        assert test_client.get(f"/api/share/{share_id}").status_code == 200


def test_directive_removed_is_404(device):
    with client() as test_client:
        share_id = shared(test_client, query_type=PRIVATE)["id"]
        configure_devices(private=False)
        assert test_client.get(f"/api/share/{share_id}").status_code == 404


def test_device_removed_is_404(device):
    with client() as test_client:
        share_id = shared(test_client)["id"]
    use_state().redis.set(
        "devices",
        Devices(
            {
                "name": "other",
                "address": "192.0.2.2",
                "platform": "frr",
                "credential": {"username": "test", "password": "test"},
                "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
            }
        ),
    )
    with client() as test_client:
        assert test_client.get(f"/api/share/{share_id}").status_code == 404


# Deleting a share


def test_delete_with_token(device):
    with client() as test_client:
        created = shared(test_client)
        response = test_client.delete(
            f"/api/share/{created['id']}", headers={DELETE_HEADER: created["deleteToken"]}
        )
        assert response.status_code == 204
        assert test_client.get(f"/api/share/{created['id']}").status_code == 404
        again = test_client.delete(
            f"/api/share/{created['id']}", headers={DELETE_HEADER: created["deleteToken"]}
        )
        assert again.status_code == 404
    assert stored(created["id"]) == {}
    assert index() == []


@pytest.mark.parametrize(
    "headers",
    ({}, {DELETE_HEADER: ""}, {DELETE_HEADER: "wrong"}, {"Authorization": "Bearer x"}),
    ids=("missing", "empty", "wrong", "other-header"),
)
def test_delete_without_the_token_is_404(device, headers):
    with client() as test_client:
        created = shared(test_client)
        response = test_client.delete(f"/api/share/{created['id']}", headers=headers)
        assert response.status_code == 404
        assert response.json()["output"] == MESSAGES["share_not_found"]
        assert test_client.get(f"/api/share/{created['id']}").status_code == 200
    assert index() == [created["id"].encode()]


def test_wrong_token_and_missing_id_answer_the_same(device):
    with client() as test_client:
        created = shared(test_client)
        wrong = test_client.delete(f"/api/share/{created['id']}", headers={DELETE_HEADER: "x" * 43})
        missing = test_client.delete(f"/api/share/{'0' * 32}", headers={DELETE_HEADER: "x" * 43})
    assert (wrong.status_code, wrong.json()) == (missing.status_code, missing.json())


def test_token_in_the_url_is_ignored(device):
    with client() as test_client:
        created = shared(test_client)
        for url in (
            f"/api/share/{created['id']}?deleteToken={created['deleteToken']}",
            f"/api/share/{created['id']}?token={created['deleteToken']}",
        ):
            assert test_client.delete(url).status_code == 404
        assert test_client.get(f"/api/share/{created['id']}").status_code == 200


def test_another_shares_token_does_not_delete(device):
    with client() as test_client:
        first = shared(test_client, "192.0.2.0/24")
        second = shared(test_client, "198.51.100.0/24")
        response = test_client.delete(
            f"/api/share/{first['id']}", headers={DELETE_HEADER: second["deleteToken"]}
        )
        assert response.status_code == 404
        assert test_client.get(f"/api/share/{first['id']}").status_code == 200


def test_token_compare_is_constant_time(device, monkeypatch):
    # Project
    from hyperglass import share as storage

    calls = []
    real = storage.hmac.compare_digest

    def compare(a: t.Any, b: t.Any) -> bool:
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(storage.hmac, "compare_digest", compare)
    with client() as test_client:
        created = shared(test_client)
        test_client.delete(f"/api/share/{created['id']}", headers={DELETE_HEADER: "wrong"})
        test_client.delete(f"/api/share/{'0' * 32}", headers={DELETE_HEADER: "wrong"})
    # Also for a missing share, so the timing doesn't tell the two apart.
    assert len(calls) == 2


def test_delete_token_is_never_logged_and_never_in_a_url(device):
    lines: t.List[str] = []
    handler = log.add(lines.append, level="DEBUG", format="{message} | {extra}")
    try:
        with client() as test_client:
            query_id = run_query(test_client)
            created = create(test_client, query_id).json()
            again = create(test_client, query_id).json()
            test_client.get(f"/api/share/{created['id']}")
            for token in ("wrong", created["deleteToken"], again["deleteToken"]):
                response = test_client.delete(
                    f"/api/share/{created['id']}", headers={DELETE_HEADER: token}
                )
                assert "location" not in response.headers
    finally:
        log.remove(handler)
    text = "\n".join(lines)
    assert "Share created" in text
    assert "Share deleted" in text
    for token in (created["deleteToken"], again["deleteToken"], "wrong"):
        assert token not in text
    # Project
    from hyperglass.share import token_hash

    assert token_hash(again["deleteToken"]) not in text
    # Logs name the client by its hashed identity only.
    assert CLIENT not in text
    # Standard Library
    import hashlib

    # Project
    from hyperglass.api.quota import quota_identity

    assert hashlib.sha256(quota_identity(CLIENT).encode()).hexdigest() in text


# Redis outage


@pytest.mark.parametrize("error", (RedisConnectionError, RedisTimeoutError))
def test_redis_outage_is_503_on_every_route(device, monkeypatch, error):
    with client() as test_client:
        created = shared(test_client)
        query_id = run_query(test_client)

        def unreachable(*_: t.Any, **__: t.Any) -> None:
            raise error("down")

        monkeypatch.setattr(fakeredis.FakeRedis, "execute_command", unreachable)
        monkeypatch.setattr(fakeredis.FakeRedis, "eval", unreachable)
        monkeypatch.setattr(fakeredis.FakeRedis, "pipeline", unreachable)
        responses = [
            create(test_client, query_id),
            test_client.get(f"/api/share/{created['id']}"),
            test_client.delete(
                f"/api/share/{created['id']}", headers={DELETE_HEADER: created["deleteToken"]}
            ),
        ]
    assert [r.status_code for r in responses] == [503, 503, 503]
    assert all(r.headers.get("cache-control") == "no-store" for r in responses)


def test_redis_outage_while_creating_is_503(device, monkeypatch):
    """A failure in the creation script, after the quota, is 503 too, not 500."""

    async def allowed(*_: t.Any, **__: t.Any) -> bool:
        return True

    def unreachable(*_: t.Any, **__: t.Any) -> None:
        raise RedisConnectionError("down")

    with client() as test_client:
        query_id = run_query(test_client)
        monkeypatch.setattr("hyperglass.api.share.take_quota", allowed)
        monkeypatch.setattr(fakeredis.FakeRedis, "eval", unreachable)
        assert create(test_client, query_id).status_code == 503
    assert index() == []


# Registration


def build_app(monkeypatch, **share: t.Any) -> TestClient:
    # Project
    from hyperglass.state import recovery

    monkeypatch.setattr(Settings, "disable_ui", True)
    state = use_state()
    configure_devices()
    configure(share)
    params = state.redis.get("params")
    devices = state.redis.get("devices")
    directives = state.redis.get("directives")

    def initialize():
        for key in recovery.REQUIRED_KEYS:
            state.cache.set(key, [] if key.startswith("plugins.") else None)
        state.cache.set("params", params)
        state.cache.set("devices", devices)
        state.cache.set("directives", directives)

    monkeypatch.setattr(recovery, "_initialize", initialize)
    initialize()
    # Project
    from hyperglass.api import create_app

    return TestClient(app=create_app())


def test_routes_absent_when_disabled(monkeypatch):
    with build_app(monkeypatch, enable=False) as test_client:
        paths = {route.path for route in test_client.app.routes}
        assert not any(path.startswith("/api/share") for path in paths)
        assert test_client.post("/api/share", json={"queryId": "x"}).status_code in (404, 405)
        assert test_client.get(f"/api/share/{'0' * 32}").status_code == 404
        assert test_client.delete(f"/api/share/{'0' * 32}").status_code in (404, 405)


def test_routes_present_when_enabled(monkeypatch):
    with build_app(monkeypatch, enable=True) as test_client:
        paths = {route.path for route in test_client.app.routes}
        assert {"/api/share", "/api/share/{share_id:str}"} <= paths
        response = test_client.get(f"/api/share/{'0' * 32}")
        assert response.status_code == 404
        assert response.json()["output"] == MESSAGES["share_not_found"]


def test_cors_allows_delete():
    # Project
    from hyperglass.api.middleware import create_cors_config

    assert "DELETE" in create_cors_config(use_state()).allow_methods


# Metrics


def test_share_metrics(device):
    # Third Party
    from prometheus_client import REGISTRY

    def sample(operation: str, result: str) -> float:
        labels = {"operation": operation, "result": result}
        return REGISTRY.get_sample_value("hyperglass_share_requests_total", labels) or 0.0

    expected = {
        ("create", "created"): 1,
        ("create", "reused"): 1,
        ("create", "not_found"): 1,
        ("read", "found"): 1,
        ("read", "not_found"): 1,
        ("delete", "not_found"): 1,
        ("delete", "deleted"): 1,
    }
    before = {key: sample(*key) for key in expected}
    with client() as test_client:
        query_id = run_query(test_client)
        created = create(test_client, query_id).json()
        again = create(test_client, query_id).json()
        create(test_client, "hyperglass.query." + "0" * 64)
        test_client.get(f"/api/share/{created['id']}")
        test_client.get(f"/api/share/{'0' * 32}")
        test_client.delete(f"/api/share/{created['id']}", headers={DELETE_HEADER: "wrong"})
        test_client.delete(
            f"/api/share/{created['id']}", headers={DELETE_HEADER: again["deleteToken"]}
        )
    assert {key: sample(*key) - before[key] for key in expected} == expected


# Review follow-ups


@pytest.mark.parametrize("name", ("index", "stray", "0" * 31, "0" * 32 + ":x", "*"))
def test_storage_refuses_names_that_are_not_share_ids(device, name):
    # Project
    from hyperglass import share as storage

    with client() as test_client:
        created = shared(test_client)
    raw().set("hyperglass.share:stray", "x")
    instance = raw()
    assert storage.read_share(instance, name).status == "not_found"
    assert storage.delete_share(instance, name) is False
    assert storage.delete_share_with_token(instance, name, created["deleteToken"]) is False
    assert index() == [created["id"].encode()]
    assert raw().get("hyperglass.share:stray") == b"x"


def test_index_path_is_404(device):
    with client() as test_client:
        created = shared(test_client)
        read = test_client.get("/api/share/index")
        removed = test_client.delete(
            "/api/share/index", headers={DELETE_HEADER: created["deleteToken"]}
        )
    assert (read.status_code, removed.status_code) == (404, 404)
    assert index() == [created["id"].encode()]


def test_overlong_token_is_not_looked_up(device, monkeypatch):
    # Project
    from hyperglass import share as storage

    tokens = []
    real = storage.delete_share_with_token

    def spy(instance: t.Any, share_id: str, token: str) -> bool:
        tokens.append(token)
        return real(instance, share_id, token)

    monkeypatch.setattr(storage, "delete_share_with_token", spy)
    with client() as test_client:
        created = shared(test_client)
        for size in (129, 128):
            response = test_client.delete(
                f"/api/share/{created['id']}", headers={DELETE_HEADER: "x" * size}
            )
            assert response.status_code == 404
    assert tokens == ["x" * 128]


def test_every_share_response_is_no_store(device):
    # Three creations pass validation; the fourth is over the quota.
    configure({"quota": {"client_limit": 3, "global_limit": 100, "window": 60}})
    with client() as test_client:
        query_id = run_query(test_client)
        created = create(test_client, query_id)
        responses = [
            created,
            create(test_client, query_id),
            test_client.get(f"/api/share/{created.json()['id']}"),
            test_client.get(f"/api/share/{'0' * 32}"),
            test_client.post("/api/share", json={}),
            test_client.post(
                "/api/share",
                content=json.dumps({"queryId": query_id}),
                headers={"Content-Type": "text/plain"},
            ),
            test_client.post(
                "/api/share",
                content='{"queryId": "' + query_id + '"' + " " * 2000 + "}",
                headers={"Content-Type": "application/json"},
            ),
            create(test_client, "hyperglass.query." + "0" * 64),
            create(test_client, "hyperglass.query." + "1" * 64),
            test_client.delete(f"/api/share/{'0' * 32}", headers={DELETE_HEADER: "x"}),
            test_client.delete(
                f"/api/share/{created.json()['id']}",
                headers={DELETE_HEADER: created.json()["deleteToken"]},
            ),
        ]
    statuses = [r.status_code for r in responses]
    assert statuses == [201, 200, 200, 404, 400, 415, 413, 404, 429, 404, 404]
    assert [r.headers.get("cache-control") for r in responses] == ["no-store"] * len(responses)


def test_body_size_limit(device):
    with client() as test_client:
        query_id = run_query(test_client)
        response = test_client.post(
            "/api/share",
            content='{"queryId": "' + query_id + '"' + " " * 1000 + "}",
            headers={"Content-Type": "application/json"},
        )
    assert response.status_code == 413
    assert index() == []


@pytest.mark.parametrize(
    "content_type", ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data")
)
def test_create_requires_json(device, content_type):
    configure({"quota": {"client_limit": 1, "global_limit": 10, "window": 60}})
    with client() as test_client:
        query_id = run_query(test_client)
        refused = test_client.post(
            "/api/share",
            content=json.dumps({"queryId": query_id}),
            headers={"Content-Type": content_type},
        )
        # A refused request doesn't use the client's quota.
        accepted = create(test_client, query_id)
    assert refused.status_code == 415
    assert accepted.status_code == 201


def test_share_routes_are_not_in_the_openapi_schema(monkeypatch):
    with build_app(monkeypatch, enable=True) as test_client:
        paths = {route.path for route in test_client.app.routes}
        assert "/api/share" in paths
        schema = test_client.app.openapi_schema
    assert "/api/query" in schema.paths
    assert not any(path.startswith("/api/share") for path in schema.paths)


def test_delete_rechecks_the_token_in_the_script(device, monkeypatch):
    """A token replaced between the comparison and the deletion doesn't delete."""
    # Project
    from hyperglass import share as storage

    real = storage.hmac.compare_digest

    def compare_then_replace(a: t.Any, b: t.Any) -> bool:
        result = real(a, b)
        raw().hset(f"hyperglass.share:{created['id']}", "token", "f" * 64)
        return result

    with client() as test_client:
        created = shared(test_client)
        monkeypatch.setattr(storage.hmac, "compare_digest", compare_then_replace)
        response = test_client.delete(
            f"/api/share/{created['id']}", headers={DELETE_HEADER: created["deleteToken"]}
        )
    assert response.status_code == 404
    assert stored(created["id"])[b"token"] == b"f" * 64
    assert index() == [created["id"].encode()]


def test_share_ids_have_full_entropy(monkeypatch):
    # Project
    from hyperglass import share as storage

    sizes = []
    real = storage.secrets.token_hex

    def spy(nbytes: int) -> str:
        sizes.append(nbytes)
        return real(nbytes)

    monkeypatch.setattr(storage.secrets, "token_hex", spy)
    ids = [storage.new_share_id() for _ in range(256)]
    assert set(sizes) == {16}
    assert len(set(ids)) == len(ids)
    assert all(storage.valid_share_id(share_id) for share_id in ids)
    # Every position varies: no fixed padding or prefix.
    assert all(len({share_id[i] for share_id in ids}) > 1 for i in range(32))


def full(*_: t.Any, **__: t.Any) -> None:
    raise OutOfMemoryError("command not allowed when used memory > 'maxmemory'.")


async def full_quota(*_: t.Any, **__: t.Any) -> bool:
    full()
    return False


def test_reads_and_deletes_work_when_redis_is_full(device, monkeypatch):
    """Under `noeviction` at `maxmemory`, the quota counter can't be written: still serve."""
    with client() as test_client:
        created = shared(test_client)
        monkeypatch.setattr("hyperglass.api.share.take_quota", full_quota)
        read = test_client.get(f"/api/share/{created['id']}")
        removed = test_client.delete(
            f"/api/share/{created['id']}", headers={DELETE_HEADER: created["deleteToken"]}
        )
    assert read.status_code == 200
    assert removed.status_code == 204


def test_create_when_redis_is_full_is_503(device, monkeypatch):
    async def allowed(*_: t.Any, **__: t.Any) -> bool:
        return True

    with client() as test_client:
        query_id = run_query(test_client)
        monkeypatch.setattr("hyperglass.api.share.take_quota", full_quota)
        over_quota_script = create(test_client, query_id)
        monkeypatch.setattr("hyperglass.api.share.take_quota", allowed)
        monkeypatch.setattr(fakeredis.FakeRedis, "eval", full)
        over_create_script = create(test_client, query_id)
    for response in (over_quota_script, over_create_script):
        assert response.status_code == 503
        assert response.json()["output"] == MESSAGES["share_unavailable"]
    assert index() == []


def test_corrupt_existing_share_is_replaced(device):
    with client() as test_client:
        query_id = run_query(test_client)
        first = create(test_client, query_id).json()
        tamper(first["id"], "{not json")
        again = create(test_client, query_id)
        assert again.status_code == 201
        second = again.json()
        assert second["id"] != first["id"]
        assert test_client.get(f"/api/share/{second['id']}").status_code == 200
    assert stored(first["id"]) == {}
    assert index() == [second["id"].encode()]


def test_delete_counts_against_the_read_quota(device):
    configure({"read_quota": {"client_limit": 2, "global_limit": 100, "window": 30}})
    with client() as test_client:
        statuses = [
            test_client.delete(f"/api/share/{'0' * 32}", headers={DELETE_HEADER: "x"}).status_code
            for _ in range(3)
        ]
    assert statuses == [404, 404, 429]


def test_cache_entry_has_no_share_fields_when_sharing_is_off(device):
    configure({"enable": False})
    with client() as test_client:
        query_id = run_query(test_client)
    fields = raw().hkeys(use_state().redis.key(query_id))
    assert b"output" in fields
    assert not {b"query", b"labels", b"format", b"runtime", b"result_id"} & set(fields)


def test_entries_evicted_by_redis_free_their_place(device):
    """A share Redis evicted before it expired leaves an index entry; a full store prunes it."""
    configure({"max_entries": 1})
    with client() as test_client:
        first = shared(test_client)["id"]
        raw().delete(f"hyperglass.share:{first}")
        second = create(test_client, run_query(test_client, "198.51.100.0/24"))
    assert second.status_code == 201
    assert index() == [second.json()["id"].encode()]


def test_expired_ids_leave_the_index_on_create(device):
    """Expired ids are removed by score on every create, not only when the store is full."""
    with client() as test_client:
        first = shared(test_client)["id"]
        raw().delete(f"hyperglass.share:{first}")
        raw().zadd("hyperglass.share:index", {first: 1})
        second = shared(test_client, "198.51.100.0/24")["id"]
    assert index() == [second.encode()]


def test_no_key_is_named_from_a_non_id():
    # Project
    from hyperglass import share as storage

    for name in ("index", "*", "0" * 31):
        with pytest.raises(ValueError):
            storage._key(name)


def test_routes_do_not_look_up_non_ids(device, monkeypatch):
    # Project
    from hyperglass import share as storage

    looked_up = []
    monkeypatch.setattr(storage, "read_share", lambda *args: looked_up.append(args))
    monkeypatch.setattr(storage, "delete_share_with_token", lambda *args: looked_up.append(args))
    with client() as test_client:
        read = test_client.get("/api/share/index")
        removed = test_client.delete("/api/share/index", headers={DELETE_HEADER: "x" * 43})
    assert (read.status_code, removed.status_code) == (404, 404)
    assert looked_up == []


@pytest.mark.parametrize(
    "config",
    ({"max_timeout": DAY, "timeout": DAY, "timeout_choices": [7 * DAY]}, {"timeout_choices": []}),
)
def test_no_choice_left_is_reported_as_such(config):
    with pytest.raises(ValueError, match="no time within share.max_timeout"):
        Params(share=config)


def test_expiry_not_offered_does_not_use_the_quota(device):
    configure({"quota": {"client_limit": 1, "global_limit": 10, "window": 60}})
    with client() as test_client:
        query_id = run_query(test_client)
        refused = create(test_client, query_id, expiresIn=3600)
        accepted = create(test_client, query_id)
    assert (refused.status_code, accepted.status_code) == (400, 201)
