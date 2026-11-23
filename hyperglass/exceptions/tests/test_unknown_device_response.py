"""`GET /api/devices/<id>` answers 404 for a device that doesn't exist (#530)."""

# Third Party
import pytest

# Project
from hyperglass.log import log
from hyperglass.models.config.params import Params

# hyperglass.api reads state when it is imported, so import it inside the tests,
# after the autouse fixture in conftest.py has seeded the isolated store. The `state`
# and `client` fixtures are in this directory's conftest.py.

NOT_FOUND = "No {type} called {name} here."


@pytest.fixture
def records():
    """Collect the levels of log records emitted during the test."""
    levels = []
    handler = log.add(lambda message: levels.append(message.record["level"].name), level="DEBUG")
    yield levels
    log.remove(handler)


@pytest.fixture
def configured(state):
    """Configure the not-found message, to show the response text comes from params."""
    state.cache.set(
        "params",
        Params(messages={"not_found": NOT_FOUND}, web={"text": {"query_location": "Router"}}),
    )
    return state


def test_unknown_device_returns_404(client, configured, records):
    response = client.get("/api/devices/nonexistent")

    assert response.status_code == 404
    body = response.json()
    assert body["output"] == "No Router called nonexistent here."
    assert body["level"] == "warning"
    assert sorted(body["keywords"]) == ["Router", "nonexistent"]
    # Any client can ask for any id, so a miss is not a server fault.
    assert "CRITICAL" not in records
    assert "WARNING" in records


def test_known_device_unchanged(client, state):
    response = client.get("/api/devices/test")

    assert response.status_code == 200
    assert response.json() == state.devices["test"].export_api()


@pytest.mark.parametrize(
    "device_id",
    (
        pytest.param("2001:db8::1", id="ipv6"),
        pytest.param("2001%3Adb8%3A%3A1", id="ipv6-encoded"),
        pytest.param("192.0.2.1", id="ipv4"),
        pytest.param("te%00st", id="encoded-nul"),
        pytest.param("%E2%9C%93", id="unicode"),
        pytest.param("TEST", id="other-case"),
        pytest.param("0", id="digit"),
        pytest.param("x" * 2048, id="long"),
    ),
)
def test_odd_ids_return_404(client, state, records, device_id):
    response = client.get(f"/api/devices/{device_id}")

    assert response.status_code == 404
    assert response.json()["level"] == "warning"
    assert "CRITICAL" not in records


@pytest.mark.parametrize("path", ("te/st", "te%2Fst"), ids=("slash", "encoded-slash"))
def test_slash_in_id_is_not_a_server_error(client, state, path):
    """A slash, encoded or not, leaves the route, and the router answers 404."""
    response = client.get(f"/api/devices/{path}")

    assert response.status_code == 404
    assert set(response.json()) == {"output", "level", "keywords"}


def test_other_not_found_errors_keep_400(client, state):
    """Only a device requested by ID is a 404; query validation errors stay 400."""
    # Project
    from hyperglass.exceptions.public import QueryTypeNotFound, QueryLocationNotFound

    assert QueryLocationNotFound(location="nonexistent").status_code == 400
    assert QueryTypeNotFound(query_type="nonexistent").status_code == 400

    response = client.post(
        "/api/query",
        json={
            "queryLocation": "nonexistent",
            "queryType": "__hyperglass_frr_bgp_route__",
            "queryTarget": "2001:db8::/32",
        },
    )
    assert response.status_code == 400
