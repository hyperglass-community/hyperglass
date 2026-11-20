"""Regenerate the UI test configuration fixture.

Loads the configuration in this directory through the same path as startup and
writes the UI parameters exactly as the UI build receives them in
`hyperglass.json`. Run from the repository root after a change to the UI
parameters or to the frontend `Config` type:

    HYPERGLASS_APP_PATH=.tests/ui-fixture python .tests/ui-fixture/generate.py

Redis is replaced by fakeredis, so no server is needed.
"""

# Standard Library
import sys
import json
from pathlib import Path

# Third Party
import fakeredis

OUTPUT = Path(__file__).parents[2] / "hyperglass" / "ui" / "__tests__" / "fixtures" / "config.json"


def main() -> None:
    """Write the UI parameters of the fixture configuration to `OUTPUT`."""
    # Project
    from hyperglass.state import manager, use_state
    from hyperglass.state.hooks import _use_state

    server = fakeredis.FakeServer()
    manager.Redis = lambda **_: fakeredis.FakeRedis(server=server)
    _use_state.cache_clear()

    # Project
    from hyperglass.configuration import init_user_config

    init_user_config()
    data = json.loads(use_state("ui_params").export_json(by_alias=True))
    OUTPUT.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    sys.stdout.write(f"Wrote {OUTPUT}\n")


if __name__ == "__main__":
    main()
