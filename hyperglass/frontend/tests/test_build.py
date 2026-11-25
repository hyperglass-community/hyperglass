"""Tests for the packaged UI build workspace."""

# Standard Library
import asyncio
from pathlib import Path

# Third Party
import pytest

# Project
from hyperglass.frontend import (
    PACKAGE_PNPM_STORE,
    build_ui,
    node_initial,
    build_frontend,
    generate_favicons,
    _ui_subprocess_env,
    _prepare_ui_build_dir,
    _read_ui_export_version,
    _ui_export_matches_version,
)


def test_prepare_ui_build_dir_reuses_packaged_dependencies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reuse dependencies bundled in the container rather than copying them."""
    package_ui = tmp_path / "package-ui"
    package_ui.mkdir()
    (package_ui / "package.json").write_text("{}")
    (package_ui / "node_modules").mkdir()
    (package_ui / "node_modules" / "dependency").mkdir()
    monkeypatch.setattr("hyperglass.frontend.PACKAGE_UI_DIR", package_ui)

    ui_dir = _prepare_ui_build_dir(tmp_path / "app")

    assert ui_dir == tmp_path / "app" / ".ui"
    assert (ui_dir / "package.json").exists()
    assert (ui_dir / "node_modules").is_symlink()
    assert (ui_dir / "node_modules").resolve() == package_ui / "node_modules"
    assert not (ui_dir / ".next").exists()
    assert not (ui_dir / "out").exists()
    assert not (ui_dir / "hyperglass.json").exists()
    assert (ui_dir / ".npmrc").read_text() == f"store-dir={PACKAGE_PNPM_STORE}\n"


def test_ui_subprocess_env_pins_pnpm_store() -> None:
    """UI subprocesses must use the packaged pnpm store, not app_path."""
    env = _ui_subprocess_env()
    assert env["PNPM_CONFIG_STORE_DIR"] == str(PACKAGE_PNPM_STORE)


def test_read_ui_export_version_from_index_html(tmp_path: Path) -> None:
    """Read the exported UI version from the hyperglass-version meta tag."""
    ui_dir = tmp_path / "static" / "ui"
    ui_dir.mkdir(parents=True)
    (ui_dir / "index.html").write_text(
        '<meta name="hyperglass-version" content="3.1.0" />',
        encoding="utf-8",
    )

    assert _read_ui_export_version(tmp_path) == "3.1.0"


def test_ui_export_matches_version_rejects_stale_export(tmp_path: Path) -> None:
    """A persisted export from an older release must not suppress rebuilds."""
    ui_dir = tmp_path / "static" / "ui"
    ui_dir.mkdir(parents=True)
    (ui_dir / "index.html").write_text(
        '<meta name="hyperglass-version" content="3.1.0" />',
        encoding="utf-8",
    )

    assert _ui_export_matches_version(tmp_path, "3.2.2") is False
    assert _ui_export_matches_version(tmp_path, "3.1.0") is True


@pytest.mark.parametrize("index_html", (None, "<html></html>"))
def test_ui_export_matches_version_rejects_incomplete_export(
    tmp_path: Path, index_html: str | None
) -> None:
    """An incomplete export must not suppress a required rebuild."""
    ui_dir = tmp_path / "static" / "ui"
    ui_dir.mkdir(parents=True)
    if index_html is not None:
        (ui_dir / "index.html").write_text(index_html, encoding="utf-8")

    assert _ui_export_matches_version(tmp_path, "3.2.2") is False


def test_generate_favicons_from_svg(tmp_path: Path) -> None:
    """Generate the complete favicon set from the built-in SVG icon."""
    pytest.importorskip("cairosvg")
    source = Path(__file__).parents[2] / "images" / "hyperglass-icon.svg"
    output = tmp_path / "favicons"

    formats = generate_favicons(source, output)

    assert len(formats) == 21
    assert (output / "favicon-64x64.ico").exists()
    assert (output / "favicon-196x196.png").exists()


def test_failed_build_does_not_record_build_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed build must not make a stale export appear current."""
    package_ui = tmp_path / "package-ui"
    package_ui.mkdir()
    (package_ui / "package.json").write_text("{}")
    (package_ui / "node_modules").mkdir()
    monkeypatch.setattr("hyperglass.frontend.PACKAGE_UI_DIR", package_ui)

    app_path = tmp_path / "app"
    (app_path / "static" / "ui").mkdir(parents=True)
    (app_path / "static" / "images" / "favicons").mkdir(parents=True)
    dot_env_file = app_path / ".ui" / ".env"
    dot_env_file.parent.mkdir()
    dot_env_file.write_text("HYPERGLASS_BUILD_ID=old-build")

    class Logo:
        favicon = package_ui / "favicon.svg"

    class Web:
        logo = Logo()
        custom_javascript = None
        custom_html = None
        opengraph = type("OpenGraph", (), {"image": package_ui / "opengraph.png"})()
        theme = type(
            "Theme",
            (),
            {
                "colors": type("Colors", (), {"black": "#000000"})(),
                "fonts": type(
                    "Fonts", (), {"body": "Nunito", "mono": "Fira Code", "download": False}
                )(),
            },
        )()

    class Params:
        web = Web()

        def export_json(self, by_alias: bool) -> str:
            return "{}"

        def export_dict(self) -> dict:
            return {}

    async def fail_build(*args, **kwargs):
        raise RuntimeError("build failed")

    async def skip_node_initial(*args, **kwargs):
        return ""

    monkeypatch.setattr("hyperglass.frontend.build_ui", fail_build)
    monkeypatch.setattr("hyperglass.frontend.node_initial", skip_node_initial)
    monkeypatch.setattr("hyperglass.frontend.generate_favicons", lambda *args: ())
    monkeypatch.setattr("hyperglass.frontend.self_host_fonts", lambda *args: False)

    with pytest.raises(RuntimeError, match="build failed"):
        asyncio.run(
            build_frontend(
                dev_mode=False,
                dev_url="http://localhost/",
                prod_url="/api/",
                params=Params(),
                app_path=app_path,
            )
        )

    assert "HYPERGLASS_BUILD_ID" not in dot_env_file.read_text()


def test_node_initial_returns_command_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Return the `pnpm install` output unchanged, not one character per line."""

    class Proc:
        returncode = 0

        async def communicate(self):
            return b"Lockfile is up to date\nDone in 1s\n", b""

        async def wait(self):
            return 0

    async def create_subprocess_shell(*args, **kwargs):
        return Proc()

    monkeypatch.setattr(asyncio, "create_subprocess_shell", create_subprocess_shell)

    result = asyncio.run(node_initial(ui_path=tmp_path))

    assert result == "Lockfile is up to date\nDone in 1s"


def _custom_files_params(custom_javascript: Path):
    """Build a minimal UIParameters stand-in with a custom JavaScript file."""

    class Web:
        logo = type("Logo", (), {"favicon": custom_javascript})()
        opengraph = type("OpenGraph", (), {"image": custom_javascript})()
        theme = type(
            "Theme",
            (),
            {
                "colors": type("Colors", (), {"black": "#000000"})(),
                "fonts": type(
                    "Fonts", (), {"body": "Nunito", "mono": "Fira Code", "download": False}
                )(),
            },
        )()
        custom_html = None

    Web.custom_javascript = custom_javascript

    class Params:
        web = Web()

        def export_json(self, by_alias: bool) -> str:
            return "{}"

        def export_dict(self) -> dict:
            return {"web": {"custom_javascript": str(custom_javascript)}}

    return Params()


def test_custom_files_written_before_build_and_change_build_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Custom files must exist for the first build, and editing them must rebuild (#440)."""
    # Project
    from hyperglass.constants import __version__

    package_ui = tmp_path / "package-ui"
    package_ui.mkdir()
    (package_ui / "package.json").write_text("{}")
    (package_ui / "node_modules").mkdir()
    monkeypatch.setattr("hyperglass.frontend.PACKAGE_UI_DIR", package_ui)

    app_path = tmp_path / "app"
    (app_path / "static" / "images" / "favicons").mkdir(parents=True)
    custom_js = tmp_path / "custom.js"
    custom_js.write_text("console.log('first');")

    seen = []

    async def fake_build_ui(app_path: Path, ui_path: Path) -> str:
        seen.append((ui_path / "custom.js").read_text())
        export = app_path / "static" / "ui"
        export.mkdir(parents=True, exist_ok=True)
        (export / "index.html").write_text(
            f'<meta name="hyperglass-version" content="{__version__}" />'
        )
        return "built"

    monkeypatch.setattr("hyperglass.frontend.build_ui", fake_build_ui)
    monkeypatch.setattr("hyperglass.frontend.generate_favicons", lambda *args: ())
    monkeypatch.setattr("hyperglass.frontend.self_host_fonts", lambda *args: True)
    monkeypatch.setattr("hyperglass.frontend.migrate_images", lambda *args: True)
    monkeypatch.setattr("hyperglass.frontend.generate_opengraph", lambda *args: True)

    def run() -> None:
        asyncio.run(
            build_frontend(
                dev_mode=False,
                dev_url="http://localhost/",
                prod_url="/api/",
                params=_custom_files_params(custom_js),
                app_path=app_path,
            )
        )

    run()
    assert seen == ["console.log('first');"]

    # Unchanged contents: the recorded build ID matches, so no rebuild.
    run()
    assert len(seen) == 1

    # Changed contents at the same path: the build ID changes, so rebuild.
    custom_js.write_text("console.log('second');")
    run()
    assert seen == ["console.log('first');", "console.log('second');"]


def test_build_ui_disables_next_telemetry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`next build` must run with Next.js telemetry disabled (#433)."""
    ui_dir = tmp_path / "ui"
    (ui_dir / "out").mkdir(parents=True)
    calls = []

    class Proc:
        returncode = 0

        async def communicate(self):
            return b"built", b""

        async def wait(self):
            return 0

    async def create_subprocess_shell(*args, **kwargs):
        calls.append(kwargs)
        return Proc()

    monkeypatch.setattr(asyncio, "create_subprocess_shell", create_subprocess_shell)

    asyncio.run(build_ui(app_path=tmp_path / "app", ui_path=ui_dir))

    assert calls[0]["cmd"] == "node_modules/.bin/next build"
    assert calls[0]["env"]["NEXT_TELEMETRY_DISABLED"] == "1"


@pytest.mark.parametrize("download", (False, True))
def test_build_frontend_passes_font_download_setting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, download: bool
) -> None:
    """Only web.theme.fonts.download may let the build download fonts (#434)."""
    package_ui = tmp_path / "package-ui"
    package_ui.mkdir()
    (package_ui / "package.json").write_text("{}")
    (package_ui / "node_modules").mkdir()
    monkeypatch.setattr("hyperglass.frontend.PACKAGE_UI_DIR", package_ui)
    (tmp_path / "app" / "static" / "images" / "favicons").mkdir(parents=True)
    custom_js = tmp_path / "custom.js"
    custom_js.write_text("")
    params = _custom_files_params(custom_js)
    params.web.theme.fonts.download = download
    calls = []

    async def fake_build_ui(*args, **kwargs) -> str:
        return "built"

    monkeypatch.setattr("hyperglass.frontend.build_ui", fake_build_ui)
    monkeypatch.setattr("hyperglass.frontend.generate_favicons", lambda *args: ())
    monkeypatch.setattr("hyperglass.frontend.self_host_fonts", lambda *args: calls.append(args))
    monkeypatch.setattr("hyperglass.frontend.migrate_images", lambda *args: True)
    monkeypatch.setattr("hyperglass.frontend.generate_opengraph", lambda *args: True)

    asyncio.run(
        build_frontend(
            dev_mode=False,
            dev_url="http://localhost/",
            prod_url="/api/",
            params=params,
            app_path=tmp_path / "app",
        )
    )

    assert calls[0][0] == {"body": "Nunito", "mono": "Fira Code"}
    assert calls[0][2] is download
