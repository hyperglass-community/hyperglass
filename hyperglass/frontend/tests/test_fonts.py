"""Self-hosted UI fonts (#49, #434)."""

# Standard Library
import re

# Third Party
import httpx
import pytest

# Project
from hyperglass.frontend import VENDORED_FONTS, VENDORED_FONTS_DIR, google_font_url, self_host_fonts
from hyperglass.models.config.web import ThemeFonts

CSS = """@font-face {
  font-family: 'Inter';
  src: url(https://fonts.gstatic.com/s/inter/v1/abc.woff2) format('woff2');
}"""


def _client(handler):
    original = httpx.Client

    def client(**kwargs):
        return original(transport=httpx.MockTransport(handler), **kwargs)

    return client


@pytest.fixture
def no_network(monkeypatch):
    """Fail the test on any HTTP request."""

    def handler(request):
        raise AssertionError(f"Unexpected request to {request.url}")

    monkeypatch.setattr(httpx, "Client", _client(handler))


def test_google_font_url():
    assert google_font_url("Fira Code") == (
        "https://fonts.googleapis.com/css?family=Fira+Code:300,400,700&display=swap"
    )


def test_default_fonts_are_vendored():
    """The default theme fonts ship with the package, with their licences."""
    defaults = ThemeFonts()
    assert {defaults.body, defaults.mono} <= set(VENDORED_FONTS)
    for stylesheet in VENDORED_FONTS.values():
        css = (VENDORED_FONTS_DIR / stylesheet).read_text()
        names = re.findall(r"url\(/fonts/([^)]+)\)", css)
        assert names
        assert "fonts.gstatic.com" not in css
        for name in names:
            assert (VENDORED_FONTS_DIR / name).read_bytes()[:4] == b"wOF2"
    assert (VENDORED_FONTS_DIR / "OFL-Nunito.txt").is_file()
    assert (VENDORED_FONTS_DIR / "OFL-FiraCode.txt").is_file()


def test_default_fonts_self_hosted_offline(no_network, tmp_path):
    """Default fonts must be self-hosted without network access, even with download on."""
    defaults = ThemeFonts()
    fonts = {"body": defaults.body, "mono": defaults.mono}

    assert self_host_fonts(fonts, tmp_path, download=True)

    font_dir = tmp_path / "public" / "fonts"
    for kind in ("body", "mono"):
        css = (font_dir / f"{kind}.css").read_text()
        for name in re.findall(r"url\(/fonts/([^)]+)\)", css):
            assert (font_dir / name).is_file()


def test_other_fonts_not_downloaded_by_default(no_network, tmp_path):
    """Non-default fonts are not downloaded unless web.theme.fonts.download is set."""
    assert not self_host_fonts({"body": "Inter", "mono": "Fira Code"}, tmp_path)

    font_dir = tmp_path / "public" / "fonts"
    assert not (font_dir / "body.css").exists()
    assert (font_dir / "mono.css").exists()


def test_other_fonts_downloaded_when_enabled(monkeypatch, tmp_path):
    def handler(request):
        if request.url.host == "fonts.googleapis.com":
            assert "family=Inter" in str(request.url)
            return httpx.Response(200, text=CSS)
        return httpx.Response(200, content=b"woff2")

    monkeypatch.setattr(httpx, "Client", _client(handler))

    assert self_host_fonts({"body": "Inter", "mono": "Fira Code"}, tmp_path, download=True)

    font_dir = tmp_path / "public" / "fonts"
    css = (font_dir / "body.css").read_text()
    assert "fonts.gstatic.com" not in css
    name = css.split("url(/fonts/")[1].split(")")[0]
    assert (font_dir / name).read_bytes() == b"woff2"
    assert (font_dir / "mono.css").exists()


def test_failed_download_falls_back(monkeypatch, tmp_path):
    def handler(request):
        if request.url.host == "fonts.googleapis.com":
            return httpx.Response(200, text=CSS)
        return httpx.Response(503)

    monkeypatch.setattr(httpx, "Client", _client(handler))

    assert not self_host_fonts({"body": "Inter"}, tmp_path, download=True)
    assert list((tmp_path / "public" / "fonts").iterdir()) == []


def test_download_defaults_off():
    assert ThemeFonts().download is False
