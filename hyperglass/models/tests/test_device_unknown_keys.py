"""Unknown device and credential keys are reported, not silently ignored (#107, #517)."""

# Standard Library
from unittest.mock import Mock

# Project
from hyperglass.models.config import devices
from hyperglass.models.config.devices import Device

CONFIG = {
    "name": "JHB-1",
    "address": "192.0.2.10",
    "platform": "mikrotik_routeros",
    "attrs": {"source4": "192.0.2.10", "source6": "2001:db8::10"},
    "credential": {"username": "lg", "password": "secret"},
}


def _warnings(monkeypatch, **extra):
    log = Mock()
    monkeypatch.setattr(devices, "log", log)
    Device(**CONFIG, **extra)
    return [call.args for call in log.bind.return_value.warning.call_args_list]


def test_misspelt_key_names_device_and_nearest_key(monkeypatch):
    warnings = _warnings(monkeypatch, driver_args={"global_delay_factor": 3})
    assert warnings == [
        (
            "Device {!r} has unknown key {!r}, which is ignored{}",
            "JHB-1",
            "driver_args",
            "; did you mean 'driver_config' or 'driver'?",
        )
    ]


def test_unknown_key_without_a_close_match(monkeypatch):
    assert _warnings(monkeypatch, zzz=1) == [
        ("Device {!r} has unknown key {!r}, which is ignored{}", "JHB-1", "zzz", "")
    ]


def test_known_keys_and_aliases_do_not_warn(monkeypatch):
    assert _warnings(monkeypatch, driver_config={"global_delay_factor": 3}) == []
    assert _warnings(monkeypatch, driverConfig={"global_delay_factor": 3}) == []


CREDENTIAL_WARNING = "Device {!r} has unknown key {!r} under 'credential', which is ignored{}"


def _credential_warnings(monkeypatch, extra=None):
    log = Mock()
    monkeypatch.setattr(devices, "log", log)
    Device(**{**CONFIG, "credential": {**CONFIG["credential"], **(extra or {})}})
    return log


def test_device_key_under_credential_names_device_level(monkeypatch):
    """A device key placed under `credential` says where it belongs (#517)."""
    log = _credential_warnings(monkeypatch, {"port": 2202})
    assert [call.args for call in log.bind.return_value.warning.call_args_list] == [
        (
            CREDENTIAL_WARNING,
            "JHB-1",
            "port",
            "; 'port' is a device key, set it at the device level",
        )
    ]


def test_device_alias_under_credential_names_device_level(monkeypatch):
    log = _credential_warnings(monkeypatch, {"driverConfig": {"global_delay_factor": 3}})
    assert [call.args for call in log.bind.return_value.warning.call_args_list] == [
        (
            CREDENTIAL_WARNING,
            "JHB-1",
            "driverConfig",
            "; 'driverConfig' is a device key, set it at the device level",
        )
    ]


def test_misspelt_credential_key_suggests_credential_key(monkeypatch):
    log = _credential_warnings(monkeypatch, {"pasword": "hunter2"})
    assert [call.args for call in log.bind.return_value.warning.call_args_list] == [
        (CREDENTIAL_WARNING, "JHB-1", "pasword", "; did you mean 'password'?")
    ]


def test_unknown_credential_key_without_a_close_match(monkeypatch):
    log = _credential_warnings(monkeypatch, {"zzz": 1})
    assert [call.args for call in log.bind.return_value.warning.call_args_list] == [
        (CREDENTIAL_WARNING, "JHB-1", "zzz", "")
    ]


def test_credential_warning_never_logs_values(monkeypatch):
    """Only key names are logged: an unknown key may hold a secret (#517)."""
    extra = {"password": "p4ss-value", "pasword": "hunter2", "enable_secret": "s3cr3t-enable"}
    log = _credential_warnings(monkeypatch, extra)
    assert len(log.bind.return_value.warning.call_args_list) == 2
    logged = repr(log.mock_calls)
    for value in ("p4ss-value", "hunter2", "s3cr3t-enable"):
        assert value not in logged


def test_known_credential_keys_do_not_warn(monkeypatch):
    log = _credential_warnings(monkeypatch)
    assert log.bind.return_value.warning.call_args_list == []
