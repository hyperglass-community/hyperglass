"""OS9 must finish RSA key generation before applying the startup configuration."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.fixture
def launcher(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "vrnetlab", SimpleNamespace(VM=object, VR=object))
    path = Path(__file__).resolve().parents[3] / "lab/images/os9/launch.py"
    spec = importlib.util.spec_from_file_location("lab_os9_launch", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    startup = tmp_path / "startup.cfg"
    startup.write_text("interface fortyGigE 0/0\nno shutdown\nexit\n")
    monkeypatch.setattr(module, "Path", lambda _: startup)
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    return module


def vm(launcher):
    instance = launcher.OS9VM.__new__(launcher.OS9VM)
    instance.hostname = "os9"
    instance.username = "admin"
    instance.password = ""
    instance.bootstrap_failed = False
    instance.running = False
    instance.tn = Mock()
    instance.tn.expect.return_value = (0, True, b"os9#")
    instance.logger = Mock()
    return instance


def test_startup_waits_for_actual_key_not_generation_message(launcher):
    instance = vm(launcher)
    replies = iter([
        RuntimeError("% Error: Host key is not generated."),
        b"Generating 1024-bit SSHv2 RSA key.\nos9(conf)#",
        b"No RSA key exists\nos9(conf)#",
        b"ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ==\nos9(conf)#",
    ])
    key_ready = False

    def command(value):
        nonlocal key_ready
        if value == "do show crypto key mypubkey rsa":
            reply = next(replies)
            if isinstance(reply, RuntimeError):
                raise reply
            key_ready = reply.startswith(b"ssh-rsa ")
            return reply
        if value in ("interface fortyGigE 0/0", "write memory"):
            assert key_ready, "Startup configuration sent before key generation completed"
        return b"os9(conf)#"

    instance.command = Mock(side_effect=command)
    instance.bootstrap_spin()
    assert instance.running
    assert not instance.bootstrap_failed
    assert instance.command.call_args_list[-1].args == ("write memory",)


def test_missing_key_does_not_report_success_or_apply_startup(launcher, monkeypatch):
    instance = vm(launcher)
    ticks = iter([0, 1, 181])
    monkeypatch.setattr(launcher.time, "monotonic", lambda: next(ticks))
    instance.command = Mock(return_value=b"No RSA key exists\nos9(conf)#")
    instance.bootstrap_spin()
    assert instance.bootstrap_failed
    assert not instance.running
    assert not any(
        call.args[0] in ("interface fortyGigE 0/0", "write memory")
        for call in instance.command.call_args_list
    )


def test_unexpected_console_errors_still_stop_bootstrap(launcher):
    instance = vm(launcher)
    instance.command = Mock(side_effect=RuntimeError("% Invalid input"))
    instance.bootstrap_spin()
    assert instance.bootstrap_failed
    assert not instance.running


def test_key_wait_retries_only_the_key_not_generated_error(launcher):
    instance = vm(launcher)

    def command(value):
        if value == "do show crypto key mypubkey rsa":
            raise RuntimeError("% Error: Invalid input at '^' marker.")
        return b"os9(conf)#"

    instance.command = Mock(side_effect=command)
    instance.bootstrap_spin()
    assert instance.bootstrap_failed
    assert not instance.running
    polls = [call for call in instance.command.call_args_list
             if call.args == ("do show crypto key mypubkey rsa",)]
    assert len(polls) == 1
