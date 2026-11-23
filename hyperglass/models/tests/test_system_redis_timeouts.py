"""Socket timeouts on the shared Redis connection pool (#570)."""

# Third Party
import redis
import pytest
from pydantic import ValidationError

# Project
from hyperglass.state import manager
from hyperglass.models.system import HyperglassSettings


def _settings(tmp_path, **kwargs):
    return HyperglassSettings(app_path=tmp_path, **kwargs)


def test_pool_has_socket_timeouts_by_default(tmp_path):
    pool = _settings(tmp_path).redis_connection_pool
    assert pool["socket_connect_timeout"] == 3
    assert pool["socket_timeout"] == 5


def test_pool_timeouts_from_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("HYPERGLASS_REDIS_CONNECT_TIMEOUT", "0.5")
    monkeypatch.setenv("HYPERGLASS_REDIS_SOCKET_TIMEOUT", "12.5")
    pool = _settings(tmp_path).redis_connection_pool
    assert pool["socket_connect_timeout"] == 0.5
    assert pool["socket_timeout"] == 12.5


@pytest.mark.parametrize("value", ("0", "-1", "none", "inf", "nan", "301", "1e30", "1e400"))
@pytest.mark.parametrize("name", ("REDIS_CONNECT_TIMEOUT", "REDIS_SOCKET_TIMEOUT"))
def test_pool_timeouts_must_be_in_range(tmp_path, monkeypatch, name, value):
    # 0 would make the socket non-blocking, and no timeout is the bug in #570.
    # Infinite or huge values make socket.settimeout raise OverflowError.
    monkeypatch.setenv(f"HYPERGLASS_{name}", value)
    with pytest.raises(ValidationError):
        _settings(tmp_path)


@pytest.mark.parametrize(
    "dsn",
    ("redis://192.0.2.10:6379/1", "redis://[2001:db8::10]:6379/1"),
)
def test_state_manager_pool_uses_timeouts(tmp_path, monkeypatch, dsn):
    """The pool StateManager builds passes the timeouts to every connection."""
    # The autouse fixture replaces Redis with fakeredis, which ignores the pool.
    monkeypatch.setattr(manager, "Redis", redis.Redis)
    settings = _settings(tmp_path, redis_dsn=dsn, redis_connect_timeout=1.5, redis_socket_timeout=4)
    state = manager.StateManager(settings=settings)
    pool = state.redis.instance.connection_pool
    assert pool.connection_kwargs["socket_connect_timeout"] == 1.5
    assert pool.connection_kwargs["socket_timeout"] == 4
    connection = pool.make_connection()
    assert connection.socket_connect_timeout == 1.5
    assert connection.socket_timeout == 4


def test_dsn_query_options_override_settings(tmp_path, monkeypatch):
    # redis-py applies options in the DSN over keyword arguments.
    monkeypatch.setattr(manager, "Redis", redis.Redis)
    settings = _settings(tmp_path, redis_dsn="redis://192.0.2.10:6379/1?socket_timeout=9")
    state = manager.StateManager(settings=settings)
    assert state.redis.instance.connection_pool.connection_kwargs["socket_timeout"] == 9


def test_pool_timeouts_accept_the_upper_bound(tmp_path, monkeypatch):
    monkeypatch.setenv("HYPERGLASS_REDIS_CONNECT_TIMEOUT", "300")
    monkeypatch.setenv("HYPERGLASS_REDIS_SOCKET_TIMEOUT", "300")
    pool = _settings(tmp_path).redis_connection_pool
    assert pool["socket_connect_timeout"] == 300
    assert pool["socket_timeout"] == 300
