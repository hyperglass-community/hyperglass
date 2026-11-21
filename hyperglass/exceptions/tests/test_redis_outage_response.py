"""Requests while Redis is unreachable get a JSON 503, never a bare 500."""

# Standard Library
from types import SimpleNamespace

# Third Party
import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.exceptions import ResponseError
from redis.exceptions import ConnectionError as RedisConnectionError

# Project
from hyperglass.state.store import STATE_UNAVAILABLE

# hyperglass.api reads state when it is imported, so import it inside the tests,
# after the autouse fixture in conftest.py has seeded the isolated store. The `state`
# and `client` fixtures are in this directory's conftest.py.

UNAVAILABLE = {"output": STATE_UNAVAILABLE, "level": "danger", "keywords": []}

REQUEST = SimpleNamespace(method="GET", url=SimpleNamespace(path="/api/devices"))


def redis_down(state) -> None:
    """Make every command on the shared Redis client fail to connect."""
    state.redis.instance.connection_pool.connection_kwargs["server"].connected = False


@pytest.mark.parametrize(
    "method,path,body",
    (
        pytest.param("POST", "/api/query", {}, id="query"),
        pytest.param("GET", "/api/devices", None, id="devices"),
        pytest.param("GET", "/api/info", None, id="info"),
    ),
)
def test_redis_down_before_request_returns_503(client, state, method, path, body):
    redis_down(state)
    response = client.request(method, path, json=body)

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    # The connection error names the Redis host; it is logged, not returned.
    assert "connection error" not in response.text


@pytest.mark.parametrize("target", ("192.0.2.0/24", "2001:db8::/32"))
def test_redis_down_during_request_returns_503(client, state, monkeypatch, target):
    """Redis lost after the state hook passed, at the query cache read."""
    # Project
    from hyperglass.state.redis import RedisManager

    def unreachable(*args, **kwargs):
        raise RedisConnectionError("Error 111 connecting to redis:6379. Connection refused.")

    monkeypatch.setattr(RedisManager, "get_map", unreachable)
    response = client.post(
        "/api/query",
        json={
            "queryLocation": "test",
            "queryType": "__hyperglass_frr_bgp_route__",
            "queryTarget": target,
        },
    )

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    assert "redis:6379" not in response.text


@pytest.mark.parametrize(
    "error",
    (
        pytest.param(RedisConnectionError("refused"), id="connection"),
        pytest.param(RedisTimeoutError("timed out"), id="timeout"),
    ),
)
def test_default_handler_answers_redis_outage_with_503(state, error):
    # Project
    from hyperglass.api.error_handlers import default_handler

    redis_down(state)
    response = default_handler(REQUEST, error)

    assert response.status_code == 503
    assert response.content == UNAVAILABLE


def test_default_handler_uses_configured_message(state):
    # Project
    from hyperglass.api.error_handlers import default_handler

    response = default_handler(REQUEST, RuntimeError("bug"))

    assert response.status_code == 500
    assert response.content["output"] == state.params.messages.general


@pytest.mark.parametrize(
    "error",
    (
        pytest.param(RuntimeError("bug"), id="unrelated"),
        # Not an outage: a Redis command error is a bug, so it stays a 500.
        pytest.param(ResponseError("WRONGTYPE"), id="redis-response-error"),
    ),
)
def test_default_handler_answers_without_params(state, error):
    """An error handler must not depend on Redis to build its response."""
    # Project
    from hyperglass.api.error_handlers import default_handler

    redis_down(state)
    response = default_handler(REQUEST, error)

    assert response.status_code == 500
    assert response.content == UNAVAILABLE
