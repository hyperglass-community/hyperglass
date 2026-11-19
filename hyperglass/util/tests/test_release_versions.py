"""Release updates keep deployable image pins and package versions aligned."""

import importlib.util
from pathlib import Path

import pytest


@pytest.mark.parametrize("requested,python_version,release_version", [
    ("3.0.0rc3", "3.0.0rc3", "3.0.0-rc.3"),
    ("3.0.0-rc.3", "3.0.0rc3", "3.0.0-rc.3"),
    ("3.0.0", "3.0.0", "3.0.0"),
])
def test_version_update_includes_all_deployment_pins(
    tmp_path, requested, python_version, release_version,
):
    root = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location("release_version", root / "version.py")
    version = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(version)
    upgrades = []
    for name, source, pattern in version.UPGRADES:
        target = tmp_path / source.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text())
        upgrades.append((name, target, pattern))
    version.PYPROJECT_TOML = tmp_path / "pyproject.toml"
    version.CONSTANTS = tmp_path / "hyperglass/constants.py"
    version.UPGRADES = upgrades
    version.update_versions(requested)

    assert f'version = "{python_version}"' in version.PYPROJECT_TOML.read_text()
    assert f'__version__ = "{python_version}"' in version.CONSTANTS.read_text()
    for relative in ("hyperglass/ui/package.json", "docs/package.json"):
        assert f'"version": "{release_version}"' in (tmp_path / relative).read_text()
    compose = (tmp_path / "compose.yaml").read_text()
    guide = (tmp_path / "docs/content/installation/docker.mdx").read_text()
    assert f"ghcr.io/hyperglass-community/hyperglass:{release_version}" in compose
    assert guide.count(f"/hyperglass/v{release_version}/") == 2
    assert f"`v{release_version}`" in guide
    assert f"ghcr.io/hyperglass-community/hyperglass:{release_version}" in guide
    assert "3.0.0-rc.2" not in compose + guide
    # Reapplying the same version must leave every file unchanged.
    contents = {path: path.read_bytes() for _, path, _ in upgrades}
    version.update_versions(requested)
    assert all(path.read_bytes() == content for path, content in contents.items())
