"""Test CLI command help text."""

# Standard Library
import re

# Third Party
import pytest
from typer.testing import CliRunner

# Project
from hyperglass.cli import cli

runner = CliRunner()

HELP = (
    ("devices", "Show all configured devices"),
    ("directives", "Show all configured directives"),
    ("plugins", "Show all registered plugins"),
)


@pytest.mark.parametrize(("command", "text"), HELP, ids=[c for c, _ in HELP])
def test_command_help_text(command, text):
    """Each command describes itself in its own help output (#453)."""
    result = runner.invoke(cli, [command, "--help"], terminal_width=200)

    assert result.exit_code == 0
    assert text in result.stdout


def test_cli_help_lists_distinct_descriptions():
    """`hyperglass --help` describes each command differently (#453)."""
    result = runner.invoke(cli, ["--help"], terminal_width=200)

    assert result.exit_code == 0
    for _, text in HELP:
        assert result.stdout.count(text) == 1


COMMANDS = (
    ("start",),
    ("build-ui",),
    ("system-info",),
    ("support-bundle",),
    ("clear-cache",),
    ("healthcheck",),
    ("devices",),
    ("directives",),
    ("plugins",),
    ("params",),
    ("setup",),
    ("settings",),
    ("onboard",),
    ("onboard", "device"),
    ("onboard", "check"),
    ("onboard", "test"),
    ("onboard", "directive"),
)


def test_commands_cover_cli():
    """`COMMANDS` lists every registered command, so a new command gets a help test."""
    registered = {(command.name,) for command in cli.registered_commands}
    for group in cli.registered_groups:
        registered.add((group.name,))
        registered.update(
            (group.name, command.name) for command in group.typer_instance.registered_commands
        )

    assert registered == set(COMMANDS)


@pytest.mark.parametrize("command", COMMANDS, ids=[" ".join(c) for c in COMMANDS])
def test_command_help(command):
    """Each command parses `--help` without running."""
    result = runner.invoke(cli, [*command, "--help"], terminal_width=200)

    assert result.exit_code == 0, (result.output, result.exception)
    assert re.search(rf"Usage: \S+ {' '.join(command)} ", result.stdout)


def test_version():
    """`--version` prints the version and exits before any command runs."""
    # Project
    from hyperglass import __version__

    result = runner.invoke(cli, ["--version"])

    assert result.exit_code == 0, (result.output, result.exception)
    assert __version__ in result.stdout


def test_no_arguments_shows_help():
    """Running the CLI without arguments prints the usage and the commands."""
    result = runner.invoke(cli, [], terminal_width=200)

    assert "Usage:" in result.output
    for (command, *_) in COMMANDS:
        assert command in result.output


@pytest.fixture
def devices():
    """Add one device to the test state, which already holds params and directives."""
    # Project
    from hyperglass.state import use_state
    from hyperglass.models.config.devices import Devices

    use_state().redis.set(
        "devices",
        Devices(
            {
                "name": "test1",
                "address": "127.0.0.1",
                "credential": {"username": "test", "password": "private-test-password"},
                "platform": "juniper",
                "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
                "directives": ["juniper_bgp_route"],
            }
        ),
    )


@pytest.mark.parametrize(
    ("command", "text"),
    (
        (["devices"], "test1"),
        (["devices", "test1"], "test1"),
        (["directives"], "BGP Route"),
        (["directives", "juniper_bgp_route"], "BGP Route"),
        (["params"], "hyperglass Configuration Parameters"),
        (["params", "messages.no_input"], "params.messages.no_input"),
        (["plugins"], ""),
    ),
    ids=lambda value: " ".join(value) if isinstance(value, list) else None,
)
def test_inspect_commands(devices, command, text):
    """The commands that render state with Rich's `Inspect` produce output."""
    result = runner.invoke(cli, command, terminal_width=200)

    assert result.exit_code == 0, (result.output, result.exception)
    assert text in result.stdout
    assert "private-test-password" not in result.stdout
