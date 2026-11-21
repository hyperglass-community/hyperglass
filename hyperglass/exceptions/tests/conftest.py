"""Fixtures for the API error response tests."""

# Third Party
import pytest
from litestar.testing import TestClient

# Project
from hyperglass.settings import Settings

# hyperglass.api reads state when it is imported, so import it inside the fixtures,
# after the autouse fixture in hyperglass/conftest.py has seeded the isolated store.


@pytest.fixture
def state(monkeypatch):
    """Seed state that passes the recovery hook, with one device to query."""
    # Project
    from hyperglass.state import recovery, use_state
    from hyperglass.models.config.devices import Devices

    monkeypatch.setattr(Settings, "disable_ui", True)
    state = use_state()
    params = state.params
    devices = Devices(
        {
            "name": "test",
            "address": "192.0.2.1",
            "platform": "frr",
            "credential": {"username": "test", "password": "test"},
            "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
        }
    )

    def initialize():
        # Stand-in for loading /etc/hyperglass.
        for key in recovery.REQUIRED_KEYS:
            state.cache.set(key, None)
        state.cache.set("params", params)
        state.cache.set("devices", devices)
        state.cache.set("plugins.input", [])
        state.cache.set("plugins.output", [])

    monkeypatch.setattr(recovery, "_initialize", initialize)
    monkeypatch.setattr(recovery, "_last_failure", 0.0)
    initialize()
    return state


@pytest.fixture
def client(state):
    # Project
    from hyperglass.api import app

    # Redis must answer the startup check, so it goes down once the app is running.
    with TestClient(app=app) as test_client:
        yield test_client
