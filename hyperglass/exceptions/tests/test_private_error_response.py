"""Internal errors raised during a request are not returned to the client (#539)."""

# Third Party
import pytest

# Project
from hyperglass.exceptions import HyperglassError

# Local
from .test_redis_outage_response import REQUEST, UNAVAILABLE, redis_down

# hyperglass.api reads state when it is imported, so import it inside the tests,
# after the autouse fixture in conftest.py has seeded the isolated store.

INTERNAL = "/etc/hyperglass/devices.yaml line 12"


def query(client, target: str):
    return client.post(
        "/api/query",
        json={
            "queryLocation": "test",
            "queryType": "__hyperglass_frr_bgp_route__",
            "queryTarget": target,
        },
    )


def raise_in_route(monkeypatch, make_error) -> None:
    """Raise `make_error()` where the route runs the device query."""
    # Project
    from hyperglass.api import routes

    async def execute(*args, **kwargs):
        raise make_error()

    monkeypatch.setattr(routes, "_execute_query", execute)


def parsing_error():
    # Project
    from hyperglass.exceptions.private import ParsingError

    return ParsingError("Failed to parse FRR traceroute output: {e}", e=INTERNAL)


def config_error():
    # Project
    from hyperglass.exceptions.private import ConfigError

    # As raised by the command builder, at the danger level.
    return ConfigError("Command has attribute missing from {d}", level="danger", d=INTERNAL)


def external_error():
    # Project
    from hyperglass.exceptions.private import ExternalError

    return ExternalError(f"Unable to create session to {INTERNAL}", level="warning")


@pytest.mark.parametrize("target", ("192.0.2.0/24", "2001:db8::/32"))
@pytest.mark.parametrize(
    "make_error",
    (
        pytest.param(parsing_error, id="parsing"),
        pytest.param(config_error, id="config"),
        pytest.param(external_error, id="external"),
        # Neither public nor private: internal by default.
        pytest.param(lambda: HyperglassError(INTERNAL), id="base"),
    ),
)
def test_private_error_in_route_returns_500(client, state, monkeypatch, make_error, target):
    raise_in_route(monkeypatch, make_error)
    response = query(client, target)

    assert response.status_code == 500
    assert response.json() == {
        "output": state.params.messages.general,
        "level": "danger",
        "keywords": [],
    }
    assert INTERNAL not in response.text


@pytest.mark.parametrize("target", ("192.0.2.0/24", "2001:db8::/32"))
def test_state_missing_during_request_returns_503(client, state, monkeypatch, target):
    """State lost from a running Redis after the state hook passed."""

    def lose_state():
        state.cache.delete("params")
        # Read params as a route does; `_required` re-raises while the event loop runs.
        return state.params

    raise_in_route(monkeypatch, lose_state)
    response = query(client, target)

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    assert "Redis store" not in response.text


def input_invalid():
    # Project
    from hyperglass.exceptions.public import InputInvalid

    return InputInvalid(error="Invalid target", target="192.0.2.0/24")


def device_timeout():
    # Project
    from hyperglass.state import use_state
    from hyperglass.exceptions.public import DeviceTimeout

    return DeviceTimeout(error="timed out", device=use_state("devices")["test"])


@pytest.mark.parametrize(
    "make_error,status",
    (
        pytest.param(input_invalid, 400, id="warning"),
        pytest.param(device_timeout, 500, id="danger"),
    ),
)
def test_public_error_unchanged(client, state, monkeypatch, make_error, status):
    raised = []

    def make():
        raised.append(make_error())
        return raised[-1]

    raise_in_route(monkeypatch, make)
    response = query(client, "2001:db8::/32")

    error = raised[0]
    body = response.json()
    assert response.status_code == status
    assert body["output"] == error.message
    assert body["level"] == error.level
    # Keywords are deduplicated through a set, so their order varies.
    assert sorted(body["keywords"]) == sorted(error.keywords)


def test_private_error_answers_without_params(state):
    """The handler must not depend on Redis to answer."""
    # Project
    from hyperglass.api.error_handlers import app_handler

    error = parsing_error()
    redis_down(state)
    response = app_handler(REQUEST, error)

    assert response.status_code == 500
    assert response.content == UNAVAILABLE
