"""Regenerate the UI test configuration fixture.

Loads the configuration in this directory through the same path as startup and
writes the UI parameters exactly as the UI build receives them in
`hyperglass.json`. Run from the repository root after a change to the UI
parameters or to the frontend `Config` type:

    python .tests/ui-fixture/generate.py

The configuration is copied to a temporary application directory first, so the
run never reads `/etc/hyperglass` or `HYPERGLASS_APP_PATH`, and the files that
startup creates (`plugins/`, `static/`) do not land in the repository. Redis is
replaced by fakeredis, so no server is needed. Paths under the repository root,
such as the default logo, are written relative to it, so every checkout
produces the same file.
"""

# Standard Library
import os
import sys
import json
import shutil
import typing as t
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
OUTPUT = ROOT / "hyperglass" / "ui" / "__tests__" / "fixtures" / "config.json"
SOURCES = ("config.yaml", "devices.yaml", "directives.yaml")


def relative_paths(value: t.Any) -> t.Any:
    """Rewrite absolute paths under the repository root as repository-relative paths."""
    if isinstance(value, dict):
        return {key: relative_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [relative_paths(item) for item in value]
    if isinstance(value, str) and value.startswith(f"{ROOT}{os.sep}"):
        return Path(value).relative_to(ROOT).as_posix()
    return value


def main() -> None:
    """Write the UI parameters of the fixture configuration to `OUTPUT`."""
    with tempfile.TemporaryDirectory(prefix="hyperglass-ui-fixture-") as app_path:
        for name in SOURCES:
            shutil.copy(HERE / name, app_path)
        # Settings reads this on import, so set it before importing hyperglass.
        os.environ["HYPERGLASS_APP_PATH"] = app_path

        # Third Party
        import fakeredis

        # Project
        from hyperglass.state import manager, use_state
        from hyperglass.state.hooks import _use_state

        server = fakeredis.FakeServer()
        manager.Redis = lambda **_: fakeredis.FakeRedis(server=server)
        _use_state.cache_clear()

        # Project
        from hyperglass.configuration import init_user_config

        init_user_config()
        data = relative_paths(json.loads(use_state("ui_params").export_json(by_alias=True)))

    OUTPUT.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    sys.stdout.write(f"Wrote {OUTPUT.relative_to(ROOT)}\n")


if __name__ == "__main__":
    main()
