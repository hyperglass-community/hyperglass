"""Plugin manager faults are raised as PluginError (#547)."""

# Third Party
import pytest

# Project
from hyperglass.plugins._manager import PluginManager, InputPluginManager
from hyperglass.exceptions.private import PluginError


def test_manager_without_type_raises_plugin_error():
    """A manager subclass that does not set `type` raises PluginError, not TypeError."""
    with pytest.raises(PluginError) as exc:

        class Untyped(PluginManager):
            pass

    assert exc.value.message.startswith("Plugin '<class ")
    assert exc.value.message.endswith(".Untyped'>' is missing a 'type' keyword argument")


def test_unregister_non_plugin_raises_plugin_error():
    """Unregistering something that is not a plugin class raises PluginError, not TypeError."""
    with pytest.raises(PluginError) as exc:
        InputPluginManager().unregister(object)

    assert exc.value.message == f"Plugin '{object!r}' is not a valid hyperglass plugin"


def test_register_non_plugin_raises_plugin_error():
    """Registering something that is not a plugin class raises PluginError."""
    with pytest.raises(PluginError) as exc:
        InputPluginManager().register(object)

    assert exc.value.message == f"Plugin '{object!r}' is not a valid hyperglass plugin"
