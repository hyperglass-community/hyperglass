"""Every platform whose commands a shell parses uses the same quoting."""

# Standard Library
from types import SimpleNamespace

# Third Party
import pytest
from netmiko.vyos import VyOSSSH
from netmiko.linux import LinuxSSH
from netmiko.ssh_dispatcher import CLASS_MAPPER

# Project
from hyperglass.constants import DRIVER_MAP, SHELL_PLATFORMS
from hyperglass.models.directive import BuiltinDirective, RuleWithPattern
from hyperglass.models.config.devices import Device
from hyperglass.defaults.directives.arcos import ARCOS_BGPRoute
from hyperglass.execution.drivers._construct import Construct

# Local
from .test_custom_shell_safety import construct, shell_output


def device_type(platform):
    return Device.get_device_type(SimpleNamespace(platform=platform))


def shell_backed():
    """Platforms whose Netmiko driver logs in to a Linux shell or VyOS operational mode."""
    platforms = {*DRIVER_MAP.keys(), *CLASS_MAPPER.keys()}
    return sorted(
        platform
        for platform in platforms
        if issubclass(CLASS_MAPPER.get(device_type(platform), object), (LinuxSSH, VyOSSSH))
    )


def test_shell_backed_platforms_and_aliases_are_listed():
    expected = {*shell_backed(), "tnsr"}  # TNSR runs commands with `dataplane shell`.
    assert {"linux_ssh", "vyos_ssh", "cumulus_linux_ssh", "frr", "arrcus_arcos"} <= expected
    assert expected - SHELL_PLATFORMS == set()


@pytest.mark.parametrize("platform", sorted(SHELL_PLATFORMS))
def test_custom_target_is_quoted_on_every_shell_platform(platform):
    command = construct(platform, "$(printf INJECTED)", "capture {target}").queries()[0]
    assert shell_output(command) == [b"$(printf INJECTED)"]


def builtin(platform, target, command):
    directive = BuiltinDirective(
        id=f"__hyperglass_{platform}_bgp_aspath__",
        name="BGP AS Path",
        field=None,
        platforms=[platform],
        rules=[RuleWithPattern(condition="*", command=command)],
    )
    device = SimpleNamespace(platform=platform, name="test", attrs={})
    query = SimpleNamespace(
        device=device, directive=directive, query_type=directive.id, query_target=target
    )
    return Construct(device, query).queries()[0]


def test_builtin_target_is_quoted_on_arcos():
    command = builtin("arrcus_arcos", "^(13335|65001)$", "capture {target} | cat")
    assert command == "capture '^(13335|65001)$' | cat"
    assert shell_output(command) == [b"^(13335|65001)$"]


def test_arcos_builtin_keeps_its_pipeline():
    # Validation marks rules as passed, so use a copy of the shared built-in.
    directive = ARCOS_BGPRoute.model_copy(deep=True)
    device = SimpleNamespace(platform="arrcus_arcos", name="test", attrs={})
    query = SimpleNamespace(
        device=device, directive=directive, query_type=directive.id, query_target="192.0.2.0/24"
    )
    assert Construct(device, query).queries() == [
        "echo 'show network-instance default protocol BGP BGP | display json' | confd_cli -C"
    ]
