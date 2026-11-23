"""Headers of the UI's own responses (#560).

A share link carries its id in the page address (`/?share=<id>`). `Referrer-Policy:
same-origin` keeps browsers from sending that address to other sites the page loads
from or links to.
"""

# Standard Library
import typing as t
from pathlib import Path

# Third Party
import pytest
from litestar.testing import TestClient

# Project
from hyperglass.settings import Settings
from hyperglass.models.config.params import Params

SHARE_ID = "0123456789abcdef0123456789abcdef"


# hyperglass.api reads state when it is imported, so it is imported inside the
# tests, after the autouse fixture in conftest.py has seeded the isolated store.


def build_client(monkeypatch, app_path: Path, *, disable_ui: bool = False) -> TestClient:
    """Build the full app with `create_app()`, serving the UI files under `app_path`."""
    # Project
    from hyperglass.state import recovery, use_state

    static = app_path / "static"
    (static / "ui").mkdir(parents=True)
    (static / "images").mkdir()
    (static / "ui" / "index.html").write_text("<html>hyperglass ui</html>")
    (static / "ui" / "404.html").write_text("<html>not found</html>")
    (static / "images" / "logo.svg").write_text("<svg></svg>")

    state = use_state()

    def initialize():
        for key in recovery.REQUIRED_KEYS:
            state.cache.set(key, [] if key.startswith("plugins.") else None)
        state.cache.set("params", Params())

    monkeypatch.setattr(recovery, "_initialize", initialize)
    initialize()
    # Imported with the UI off, as the other API tests do, then built with it on.
    monkeypatch.setattr(Settings, "disable_ui", True)

    # Project
    from hyperglass.api import create_app

    monkeypatch.setattr(Settings, "app_path", app_path)
    monkeypatch.setattr(Settings, "disable_ui", disable_ui)
    return TestClient(app=create_app())


@pytest.fixture
def client(monkeypatch, tmp_path) -> t.Generator[TestClient, None, None]:
    with build_client(monkeypatch, tmp_path) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "path",
    [
        "/",
        f"/?share={SHARE_ID}",
        f"/?share={SHARE_ID}&location=router&type=bgp_route&target=192.0.2.0/24",
        "/index.html",
        f"/index.html?share={SHARE_ID}",
    ],
)
def test_ui_pages_are_same_origin_referrer(client, path):
    """The page, with or without a share id, tells browsers not to send its address."""
    response = client.get(path)
    assert response.status_code == 200
    assert "hyperglass ui" in response.text
    assert response.headers["referrer-policy"] == "same-origin"


def test_ui_not_found_page_is_same_origin_referrer(client):
    """The UI's 404 page has the header too: its address can hold a share id as well."""
    response = client.get(f"/missing?share={SHARE_ID}")
    assert response.status_code == 404
    assert response.headers["referrer-policy"] == "same-origin"


def test_no_ui_routes_with_the_ui_disabled(monkeypatch, tmp_path):
    """With `disable_ui`, the app serves no UI files, so it sets no UI header."""
    with build_client(monkeypatch, tmp_path, disable_ui=True) as test_client:
        response = test_client.get("/")
    assert response.status_code == 404
    assert "hyperglass ui" not in response.text
