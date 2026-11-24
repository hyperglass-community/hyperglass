"""A custom directive must not use a built-in directive id (#516)."""

# Third Party
import pytest

# Project
from hyperglass import configuration
from hyperglass.state import use_state
from hyperglass.models.directive import Directives
from hyperglass.exceptions.private import ConfigError
from hyperglass.models.config.devices import Devices

BUILTIN_PING = "__hyperglass_juniper_ping__"


def devices() -> Devices:
    return Devices(
        {
            "name": "test",
            "address": "192.0.2.1",
            "platform": "juniper",
            "credential": {"username": "test", "password": "test"},
            "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
        }
    )


def custom(*ids: str) -> Directives:
    return Directives.new(
        {
            directive_id: {
                "name": "Ping",
                "field": {"description": "IP"},
                "rules": [{"condition": "::/0", "command": "ping {target}"}],
            }
            for directive_id in ids
        }
    )


@pytest.fixture
def no_files(monkeypatch):
    monkeypatch.setattr(configuration, "init_files", lambda: None)
    monkeypatch.setattr(configuration, "init_ui_params", lambda **kwargs: {})


def test_custom_directive_with_builtin_id_is_rejected(no_files):
    state = use_state()
    with pytest.raises(ConfigError) as error:
        configuration.init_user_config(
            params=state.params, directives=custom("my-ping", BUILTIN_PING), devices=devices()
        )
    message = error.value.message
    assert f"'{BUILTIN_PING}'" in message
    assert "my-ping" not in message
    assert "builtins: false" in message
    assert "start with `__`" in message


def test_every_conflicting_id_is_named(no_files):
    state = use_state()
    other = "__hyperglass_juniper_traceroute__"
    with pytest.raises(ConfigError) as error:
        configuration.init_user_config(
            params=state.params, directives=custom(BUILTIN_PING, other), devices=devices()
        )
    assert f"'{BUILTIN_PING}'" in error.value.message
    assert f"'{other}'" in error.value.message


def test_rejected_directives_are_not_cached(no_files):
    state = use_state()
    with pytest.raises(ConfigError):
        configuration.init_user_config(
            params=state.params, directives=custom(BUILTIN_PING), devices=devices()
        )
    # A merged custom directive keeps the built-in's position, so compare the item itself.
    (cached,) = state.directives.filter(BUILTIN_PING)
    assert cached._hyperglass_builtin is True
    builtins = state.directives.device_builtins(platform="juniper", table_output=False)
    assert BUILTIN_PING in [directive.id for directive in builtins]


def test_custom_directive_with_new_id_keeps_the_builtin(no_files):
    state = use_state()
    configuration.init_user_config(
        params=state.params, directives=custom("my-ping"), devices=devices()
    )
    builtins = state.directives.device_builtins(platform="juniper", table_output=False)
    assert BUILTIN_PING in [directive.id for directive in builtins]
    assert "my-ping" in [directive.id for directive in state.directives]
