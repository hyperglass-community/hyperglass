"""Require structured-output opt-in for every platform and supported alias."""

# Third Party
import pytest

# Project
from hyperglass.constants import SUPPORTED_STRUCTURED_OUTPUT
from hyperglass.models.config.devices import Device


@pytest.mark.parametrize("platform", SUPPORTED_STRUCTURED_OUTPUT)
def test_structured_output_opt_in(platform):
    config = {
        "name": "test",
        "address": "127.0.0.1",
        "platform": platform,
        "credential": {"username": "lg", "password": ""},
        "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
    }
    device = Device(**config)
    assert device.structured_output is False
    assert Device(**config, structured_output=None).structured_output is False
    assert Device(**config, structured_output=False).structured_output is False
    assert Device(**config, structured_output=True).structured_output is True
