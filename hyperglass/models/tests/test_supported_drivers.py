"""The device `driver` schema and the driver allowlist come from one constant."""

# Standard Library
import typing as t

# Third Party
import pytest
from pydantic import TypeAdapter

# Project
from hyperglass.util import get_driver
from hyperglass.constants import DRIVER_MAP, SUPPORTED_DRIVERS
from hyperglass.models.fields import SupportedDriver
from hyperglass.models.config.devices import Device


def test_schema_offers_only_supported_drivers():
    assert Device.model_fields["driver"].annotation == t.Optional[SupportedDriver]
    assert t.get_args(SupportedDriver) == SUPPORTED_DRIVERS
    assert TypeAdapter(SupportedDriver).json_schema()["enum"] == list(SUPPORTED_DRIVERS)
    assert "hyperglass_agent" not in SUPPORTED_DRIVERS


def test_platform_defaults_are_supported_drivers():
    assert set(DRIVER_MAP.values()) <= set(SUPPORTED_DRIVERS)


@pytest.mark.parametrize("driver", SUPPORTED_DRIVERS)
def test_allowlist_accepts_every_supported_driver(driver):
    assert get_driver("cisco_ios", driver) == driver


@pytest.mark.parametrize("driver", ("hyperglass_agent", "paramiko"))
def test_allowlist_rejects_other_drivers(driver):
    with pytest.raises(ValueError, match="not a supported driver"):
        get_driver("cisco_ios", driver)
