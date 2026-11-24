"""Starting with Redis unreachable fails after one Redis timeout (#570)."""

# Third Party
import pytest
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.exceptions import ConnectionError as RedisConnectionError

# Project
from hyperglass import main
from hyperglass.settings import Settings


class UnreachableState:
    """State whose Redis cannot be reached."""

    def __init__(self, error: Exception) -> None:
        self.error = error
        self.clears = 0

    def clear(self) -> None:
        """Fail to reach Redis."""
        self.clears += 1
        raise self.error


@pytest.mark.parametrize(
    "error",
    (
        pytest.param(RedisTimeoutError("Timeout connecting to server"), id="timeout"),
        pytest.param(RedisConnectionError("Connection refused"), id="connection"),
    ),
)
def test_unreachable_redis_waits_once(monkeypatch, error):
    """The failure handler does not wait on the same unreachable Redis again."""
    state = UnreachableState(error)

    def unregister_all_plugins():
        # Resetting the plugin lists writes to Redis too.
        state.clear()

    monkeypatch.setattr(main, "use_state", lambda: state)
    monkeypatch.setattr(main, "unregister_all_plugins", unregister_all_plugins)
    monkeypatch.setattr(Settings, "dev_mode", False)

    with pytest.raises(type(error)) as raised:
        main.run()

    assert raised.value is error
    assert raised.value.__context__ is None
    assert state.clears == 1


def test_other_startup_errors_still_clear_state(monkeypatch):
    clears = 0
    unregistered = 0

    def unregister_all_plugins():
        nonlocal unregistered
        unregistered += 1

    class State:
        def clear(self) -> None:
            nonlocal clears
            clears += 1

    def fail():
        raise RuntimeError("bad config")

    monkeypatch.setattr(main, "use_state", State)
    monkeypatch.setattr(main, "unregister_all_plugins", unregister_all_plugins)
    monkeypatch.setattr(Settings, "dev_mode", False)
    monkeypatch.setattr("hyperglass.configuration.init_user_config", fail)

    with pytest.raises(RuntimeError, match="bad config"):
        main.run()
    assert clears == 2
    assert unregistered == 1
