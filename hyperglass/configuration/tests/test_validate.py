"""Test configuration validation."""

# Standard Library
from pathlib import Path

# Third Party
import pytest

# Project
from hyperglass.settings import Settings
from hyperglass.exceptions.private import ConfigInvalid

# Local
from ..validate import init_directives

PY_DIRECTIVES = """
from pathlib import Path

with Path(__file__).with_name("runs.txt").open("a") as f:
    f.write("run\\n")

MAIN = {"test-directive": {"name": "Test", "field": None}}
"""

INVALID_DIRECTIVES = """
test-directive:
  field: null
"""


def test_python_directives_file_runs_once(monkeypatch, tmp_path: Path):
    """A Python directives file is executed exactly once (#450)."""
    monkeypatch.setattr(Settings, "app_path", tmp_path)
    (tmp_path / "directives.py").write_text(PY_DIRECTIVES)

    directives = init_directives()

    assert [d.id for d in directives] == ["test-directive"]
    assert (tmp_path / "runs.txt").read_text().splitlines() == ["run"]


def test_invalid_directive_raises_config_invalid(monkeypatch, tmp_path: Path):
    """A directive that fails validation raises ConfigInvalid (#450)."""
    monkeypatch.setattr(Settings, "app_path", tmp_path)
    (tmp_path / "directives.yaml").write_text(INVALID_DIRECTIVES)

    with pytest.raises(ConfigInvalid) as exc:
        init_directives()

    assert "Field: name" in exc.value.message
