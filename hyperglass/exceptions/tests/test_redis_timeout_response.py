"""An unreachable Redis is answered with a 503 within the pool's timeouts (#570)."""

# Standard Library
import time
import socket
import threading
import contextlib

# Third Party
import redis
import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError

# Project
from hyperglass.state import manager
from hyperglass.settings import Settings
from hyperglass.state.hooks import _use_state
from hyperglass.state.store import STATE_UNAVAILABLE

# The `state` and `client` fixtures are in this directory's conftest.py.

UNAVAILABLE = {"output": STATE_UNAVAILABLE, "level": "danger", "keywords": []}

TIMEOUT = 0.3
# Without timeouts, a request waits until the stand-in server gives up after
# HOLD seconds (or longer, while the kernel retries the connect). With them it
# fails after a few TIMEOUTs: the request hook and the error handler each make
# at most one attempt.
HOLD = 5
PROMPT = 2


def _family_available(family: int, host: str) -> bool:
    try:
        with socket.socket(family) as sock:
            sock.bind((host, 0))
    except OSError:
        return False
    return True


FAMILIES = (
    pytest.param(socket.AF_INET, "127.0.0.1", id="ipv4"),
    pytest.param(
        socket.AF_INET6,
        "::1",
        id="ipv6",
        marks=pytest.mark.skipif(
            not _family_available(socket.AF_INET6, "::1"), reason="no IPv6 loopback"
        ),
    ),
)


@contextlib.contextmanager
def no_reply(family: int, host: str):
    """Accept connections, never answer, and close them after HOLD seconds."""
    listener = socket.socket(family)
    listener.bind((host, 0))
    listener.listen()
    listener.settimeout(0.05)
    held = []
    stop = threading.Event()

    def serve():
        deadline = time.monotonic() + HOLD
        while not stop.is_set() and time.monotonic() < deadline:
            with contextlib.suppress(socket.timeout, OSError):
                held.append(listener.accept()[0])
        for sock in held:
            sock.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield listener.getsockname()[1]
    finally:
        stop.set()
        thread.join()
        listener.close()


@contextlib.contextmanager
def no_connect(family: int, host: str):
    """Listen with a full accept queue, so new connects are never answered.

    Linux drops a SYN while the listener's accept queue is full, which is what a
    blackholed Redis host looks like to the client. The listener closes after HOLD
    seconds, so a client without a connect timeout fails at its next SYN retry
    instead of hanging for minutes.
    """
    listener = socket.socket(family)
    listener.bind((host, 0))
    listener.listen(0)
    port = listener.getsockname()[1]
    filler = socket.create_connection((host, port), timeout=1)
    probe = socket.socket(family)
    probe.settimeout(0.2)
    try:
        probe.connect((host, port))
    except socket.timeout:
        pass
    else:
        filler.close()
        listener.close()
        pytest.skip("this kernel answers connects to a full accept queue")
    finally:
        probe.close()
    timer = threading.Timer(HOLD, listener.close)
    timer.start()
    try:
        yield port
    finally:
        timer.cancel()
        filler.close()
        listener.close()


SERVERS = (
    pytest.param(no_reply, id="no-reply"),
    pytest.param(no_connect, id="no-connect"),
)


def _dsn(family: int, host: str, port: int) -> str:
    address = f"[{host}]" if family == socket.AF_INET6 else host
    return f"redis://{address}:{port}/1"


def use_real_redis(monkeypatch, dsn: str) -> None:
    """Point the shared state at `dsn` through the pool StateManager builds."""
    monkeypatch.setattr(manager, "Redis", redis.Redis)
    monkeypatch.setattr(Settings, "redis_dsn", dsn)
    monkeypatch.setattr(Settings, "redis_connect_timeout", TIMEOUT)
    monkeypatch.setattr(Settings, "redis_socket_timeout", TIMEOUT)
    _use_state.cache_clear()


@pytest.mark.parametrize("server", SERVERS)
@pytest.mark.parametrize("family,host", FAMILIES)
@pytest.mark.parametrize(
    "method,path,body",
    (
        pytest.param(
            "POST",
            "/api/query",
            {
                "queryLocation": "test",
                "queryType": "__hyperglass_frr_bgp_route__",
                "queryTarget": "192.0.2.0/24",
            },
            id="query",
        ),
        pytest.param("GET", "/api/devices", None, id="devices"),
    ),
)
def test_unreachable_redis_answered_promptly(
    client, monkeypatch, server, family, host, method, path, body
):
    with server(family, host) as port:
        use_real_redis(monkeypatch, _dsn(family, host, port))
        start = time.monotonic()
        response = client.request(method, path, json=body)
        elapsed = time.monotonic() - start

    assert response.status_code == 503
    assert response.json() == UNAVAILABLE
    assert elapsed < PROMPT, f"took {elapsed:.2f}s"


@pytest.mark.parametrize("server", SERVERS)
@pytest.mark.parametrize("family,host", FAMILIES)
def test_pool_raises_timeout_error(monkeypatch, server, family, host):
    """The timeout surfaces as redis-py's TimeoutError, which the API maps to 503."""
    # Project
    from hyperglass.api.metrics import REDIS_UNAVAILABLE

    with server(family, host) as port:
        use_real_redis(monkeypatch, _dsn(family, host, port))
        # Project
        from hyperglass.state import use_state

        start = time.monotonic()
        with pytest.raises(RedisTimeoutError) as error:
            use_state("cache").instance.get("key")
        elapsed = time.monotonic() - start

    assert isinstance(error.value, REDIS_UNAVAILABLE)
    assert elapsed < PROMPT, f"took {elapsed:.2f}s"


@pytest.mark.parametrize("family,host", FAMILIES)
def test_health_keeps_its_own_timeout(client, monkeypatch, family, host):
    """/api/health probes Redis with its own client, not the shared pool's settings."""
    # Project
    from hyperglass.api import routes

    routes.shared_health_check.reset()
    routes._health_redis.clear()
    monkeypatch.setattr(routes, "HEALTH_REDIS_TIMEOUT", TIMEOUT)
    with no_reply(family, host) as port:
        dsn = _dsn(family, host, port)
        use_real_redis(monkeypatch, dsn)
        # A shared-pool timeout far above HOLD would fail the elapsed check
        # below if the probe used it.
        monkeypatch.setattr(Settings, "redis_socket_timeout", 60)
        start = time.monotonic()
        response = client.get("/api/health")
        elapsed = time.monotonic() - start
        probe = routes._health_redis[dsn].connection_pool.connection_kwargs

    routes.shared_health_check.reset()
    routes._health_redis.clear()
    assert response.status_code == 503
    assert response.json()["checks"]["redis"] == "error"
    assert probe["socket_timeout"] == TIMEOUT
    assert probe["socket_connect_timeout"] == TIMEOUT
    assert elapsed < PROMPT, f"took {elapsed:.2f}s"
