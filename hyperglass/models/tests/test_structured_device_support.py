"""Structured output is on by default on every platform with a parser, and opt-out."""

# Third Party
import pytest

# Project
from hyperglass.log import log
from hyperglass.constants import SUPPORTED_STRUCTURED_OUTPUT
from hyperglass.exceptions.private import ConfigError
from hyperglass.models.config.devices import Device


def device_config(platform):
    return {
        "name": "test",
        "address": "127.0.0.1",
        "platform": platform,
        "credential": {"username": "lg", "password": ""},
        "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
    }


@pytest.mark.parametrize("platform", SUPPORTED_STRUCTURED_OUTPUT)
def test_structured_output_default_on(platform):
    config = device_config(platform)
    assert Device(**config).structured_output is True
    assert Device(**config, structured_output=None).structured_output is True
    assert Device(**config, structured_output=False).structured_output is False
    assert Device(**config, structured_output=True).structured_output is True


def test_platform_without_parser_stays_text_without_warnings():
    """A platform with no structured parser defaults to text, without a log warning."""
    platform = "linux_ssh"
    assert platform not in SUPPORTED_STRUCTURED_OUTPUT
    records = []
    sink = log.add(records.append, level="WARNING")
    try:
        device = Device(**device_config(platform))
        unset = Device(**device_config(platform), structured_output=None)
        disabled = Device(**device_config(platform), structured_output=False)
    finally:
        log.remove(sink)
    assert device.structured_output is False
    assert unset.structured_output is False
    assert disabled.structured_output is False
    assert not any("table" in name for name in device.directive_ids)
    assert records == []


def test_explicit_true_on_platform_without_parser_is_an_error():
    with pytest.raises(ConfigError, match="does not support structured output"):
        Device(**device_config("linux_ssh"), structured_output=True)
