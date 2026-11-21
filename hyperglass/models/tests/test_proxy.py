"""Proxy configuration validation."""

# Third Party
import pytest

# Project
from hyperglass.exceptions.private import ConfigError
from hyperglass.models.config.proxy import Proxy

CREDENTIAL = {"username": "test", "password": "test"}


def test_proxy_linux_ssh_platform():
    """A Linux SSH proxy validates."""
    proxy = Proxy(address="192.0.2.10", credential=CREDENTIAL, platform="linux_ssh")

    assert proxy.platform == "linux_ssh"


def test_proxy_unsupported_platform_is_a_config_error():
    """An unsupported proxy platform raises ConfigError naming the proxy and platform (#547)."""
    with pytest.raises(ConfigError) as exc:
        Proxy(address="192.0.2.10", credential=CREDENTIAL, platform="juniper")

    assert exc.value.message == (
        "Proxy '192.0.2.10' uses platform 'juniper', which is currently unsupported."
    )
