"""Test CLI command help text."""

# Third Party
import pytest
from typer.testing import CliRunner

# Project
from hyperglass.cli import cli

runner = CliRunner(mix_stderr=False)

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
