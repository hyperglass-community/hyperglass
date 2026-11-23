"""Validate branding configuration variables."""

# Standard Library
import re
import typing as t
from pathlib import Path

# Third Party
from pydantic import (
    Field,
    HttpUrl,
    FilePath,
    PositiveInt,
    IPvAnyNetwork,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_extra_types.color import Color

# Project
from hyperglass.defaults import DEFAULT_HELP, DEFAULT_TERMS
from hyperglass.constants import DNS_OVER_HTTPS, FUNC_COLOR_MAP

# Local
from ..main import HyperglassModel
from .opengraph import OpenGraph

DEFAULT_IMAGES = Path(__file__).parent.parent.parent / "images"
DOH_PROVIDERS_PATTERN = "|".join(DNS_OVER_HTTPS.keys())
PERCENTAGE_PATTERN = r"^([1-9][0-9]?|100)\%?$"
HEADER_NAME_PATTERN = re.compile(r"[a-z0-9!#$%&'*+.^_`|~-]+")

Percentage = Field(pattern=r"^([1-9][0-9]?|100)\%$")
TitleMode = t.Literal["logo_only", "text_only", "logo_subtitle", "all"]
ColorMode = t.Literal["light", "dark"]
Side = t.Literal["left", "right"]
LocationDisplayMode = t.Literal["auto", "dropdown", "gallery"]


class Credit(HyperglassModel):
    """Validation model for developer credit."""

    enable: bool = True


class Link(HyperglassModel):
    """Validation model for generic link."""

    title: str
    url: HttpUrl
    show_icon: bool = True
    side: Side = "left"
    order: int = 0


class Menu(HyperglassModel):
    """Validation model for generic menu."""

    title: str
    content: str
    side: Side = "left"
    order: int = 0

    @field_validator("content")
    def validate_content(cls: "Menu", value: str) -> str:
        """Read content from file if a path is provided."""

        if len(value) < 260:
            path = Path(value)
            if path.is_file() and path.exists():
                with path.open("r") as f:
                    return f.read()
        return value


class Greeting(HyperglassModel):
    """Validation model for greeting modal."""

    enable: bool = False
    file: t.Optional[FilePath] = None
    title: str = "Welcome"
    button: str = "Continue"
    required: bool = False

    @field_validator("file")
    def validate_file(cls, value: str, info: ValidationInfo):
        """Ensure file is specified if greeting is enabled."""
        if info.data.get("enable") and value is None:
            raise ValueError("Greeting is enabled, but no file is specified.")
        return value


class Logo(HyperglassModel):
    """Validation model for logo configuration."""

    light: FilePath = DEFAULT_IMAGES / "hyperglass-light.svg"
    dark: FilePath = DEFAULT_IMAGES / "hyperglass-dark.svg"
    favicon: FilePath = DEFAULT_IMAGES / "hyperglass-icon.svg"
    width: str = Field(default="50%", pattern=PERCENTAGE_PATTERN)
    height: t.Optional[str] = Field(default=None, pattern=PERCENTAGE_PATTERN)

    @field_validator("width", "height", mode="before")
    def coerce_percentage(cls, value: t.Any) -> t.Any:
        """Accept a bare integer, such as `50`, before pattern validation."""
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        return value

    @field_validator("width", "height")
    def append_percent(cls, value: t.Optional[str]) -> t.Optional[str]:
        """Append `%` when it is missing, so the UI receives a valid CSS width."""
        if value is not None and not value.endswith("%"):
            return f"{value}%"
        return value


class LogoPublic(Logo):
    """Public logo configuration."""

    light_format: str
    dark_format: str


class Text(HyperglassModel):
    """Validation model for params.branding.text."""

    title_mode: TitleMode = "logo_only"
    title: str = Field(default="Hyperglass", max_length=32)
    subtitle: str = Field(default="Network Looking Glass", max_length=32)
    query_location: str = "Location"
    query_type: str = "Query Type"
    query_target: str = "Target"
    fqdn_tooltip: str = "Use {protocol}"  # Formatted by Javascript
    fqdn_message: str = "Your browser has resolved {fqdn} to"  # Formatted by Javascript
    fqdn_error: str = "Unable to resolve {fqdn}"  # Formatted by Javascript
    fqdn_error_button: str = "Try Again"
    cache_prefix: str = "Results cached for "
    cache_icon: str = "Cached from {time}"  # Formatted by Javascript
    complete_time: str = "Completed in {seconds}"  # Formatted by Javascript
    rpki_invalid: str = "Invalid"
    rpki_valid: str = "Valid"
    rpki_unknown: str = "No ROAs Exist"
    rpki_unverified: str = "Not Verified"
    no_communities: str = "No Communities"
    ip_error: str = "Unable to determine IP Address"
    no_ip: str = "No {protocol} Address"
    ip_select: str = "Select an IP Address"
    ip_button: str = "My IP"
    # Shown before the external lookup when `web.my_ip` is `external`.
    ip_lookup_notice: str = "This sends your IP address to myip.wtf to look it up."
    ip_lookup_confirm: str = "Look up my IP"
    # Tooltips and accessible names of the icon-only result buttons.
    copy_output: str = "Copy Output"
    reload_query: str = "Reload Query"
    # Shown under a result's header when its requery button is pressed during a forced
    # refresh cooldown, counting down.
    refresh_cooldown: str = "Refresh available in {seconds}s"  # Formatted by Javascript
    view_as_path: str = "View AS Path"
    # Results view: the button that copies a link to the query, its confirmation, and the
    # label of the field that shows the link when the clipboard isn't available.
    copy_link: str = "Copy Link"
    link_copied: str = "Link copied"
    query_link: str = "Link to this query"
    # AS path chart: modal heading and the accessible names of its zoom controls.
    as_path_title: str = "Path to {target}"  # Formatted by Javascript
    zoom_in: str = "Zoom In"
    zoom_out: str = "Zoom Out"
    fit_nodes: str = "Fit Nodes"
    # Accessible names of the table pagination buttons.
    first_page: str = "First Page"
    previous_page: str = "Previous Page"
    next_page: str = "Next Page"
    last_page: str = "Last Page"
    # Recent queries: the list on the landing page and an opened entry.
    history_title: str = "Recent queries"
    history_open: str = "Open"
    history_delete: str = "Delete"
    history_clear_all: str = "Clear all"
    history_clear_confirm: str = "Delete all saved queries from this browser?"
    history_clear_cancel: str = "Cancel"
    history_back: str = "Back"
    history_saved_at: str = "Saved {time}"  # Formatted by Javascript
    # Fill the form from a saved query, to run it again or with another target, and name
    # its locations and variable values that are no longer configured (`{locations}` and
    # `{value}` are formatted by Javascript).
    history_rerun: str = "Run again"
    history_new_target: str = "New target"
    history_location_unavailable: str = "No longer available: {locations}"
    history_variable_unavailable: str = "No longer available: {value}"
    # Shared result page (`/?share=<id>`): its heading, the time of the result and the
    # link's expiry (`{time}` is formatted by Javascript), the text while it loads and
    # when it can't be loaded, and the buttons that leave it. Not found and unsupported
    # use `messages.share_not_found` and `messages.share_unsupported`.
    share_title: str = "Shared result"
    share_loading: str = "Loading the shared result..."
    share_error: str = "The shared result could not be loaded. Please try again later."
    share_result_time: str = "Result from {time}"
    share_expires: str = "Link expires {time}"
    share_run_query: str = "Run this query"
    share_new_query: str = "New query"
    # A result's Share button (its tooltip and accessible name) and its popover: the
    # "keep for" choice, the button that creates the link, the label of the field that
    # shows it, the notice under it, and the button that deletes it with what it
    # announces. Each time to keep the link is labelled with the largest unit it is a
    # whole number of (`{count}` is formatted by Javascript). The link is copied with
    # `copy_link` and its expiry shown with `share_expires`; errors use `messages`.
    share_result: str = "Share Result"
    share_keep_for: str = "Keep for"
    share_create: str = "Create Link"
    share_link: str = "Link to this result"
    share_notice: str = "Anyone with the link can see this result, including the target."
    share_delete: str = "Delete Link"
    share_deleted: str = "Link deleted"
    # The label of a link created for an earlier result of the same query, before it ran
    # again (`{time}` is formatted by Javascript); the note on who can delete a link, which
    # depends on where this browser keeps its token; the note shown when the token no
    # longer deletes it; and what is announced when a link expires while shown.
    share_earlier_link: str = "Link to the result from {time}"  # Formatted by Javascript
    share_delete_scope: str = "You can delete the link from this page until you close or reload it."
    share_delete_rotated: str = "This link can't be deleted from this page any more: the result was shared again elsewhere. It works until it expires."
    share_link_expired: str = "The link has expired."
    share_minute: str = "{count} minute"  # Formatted by Javascript
    share_minutes: str = "{count} minutes"  # Formatted by Javascript
    share_hour: str = "{count} hour"  # Formatted by Javascript
    share_hours: str = "{count} hours"  # Formatted by Javascript
    share_day: str = "{count} day"  # Formatted by Javascript
    share_days: str = "{count} days"  # Formatted by Javascript

    @field_validator("cache_prefix")
    def validate_cache_prefix(cls: "Text", value: str) -> str:
        """Ensure trailing whitespace."""
        return " ".join(value.split()) + " "


class History(HyperglassModel):
    """Validation model for the query history each browser keeps."""

    enable: bool = True
    limit: int = Field(default=10, ge=1, le=50)


class ThemeColors(HyperglassModel):
    """Validation model for theme colors."""

    black: Color = "#000000"
    white: Color = "#ffffff"
    dark: Color = "#010101"
    light: Color = "#f5f6f7"
    gray: Color = "#c1c7cc"
    filtered: Color = "#c1c7cc"
    red: Color = "#d84b4b"
    orange: Color = "#ff6b35"
    yellow: Color = "#edae49"
    green: Color = "#35b246"
    blue: Color = "#314cb6"
    teal: Color = "#35b299"
    cyan: Color = "#118ab2"
    pink: Color = "#f2607d"
    purple: Color = "#8d30b5"
    primary: t.Optional[Color] = None
    secondary: t.Optional[Color] = None
    success: t.Optional[Color] = None
    warning: t.Optional[Color] = None
    error: t.Optional[Color] = None
    danger: t.Optional[Color] = None

    @field_validator(*FUNC_COLOR_MAP.keys(), mode="before")
    def validate_colors(cls: "ThemeColors", value: str, info: ValidationInfo) -> str:
        """Set default functional color mapping."""
        if value is None:
            default_color = FUNC_COLOR_MAP[info.field_name]
            value = str(info.data[default_color])
        return value

    def dict(self, *args: t.Any, **kwargs: t.Any) -> t.Dict[str, str]:
        """Return dict for colors only."""
        return {k: v.as_hex() for k, v in self.__dict__.items()}


class ThemeFonts(HyperglassModel):
    """Validation model for theme fonts."""

    body: str = "Nunito"
    mono: str = "Fira Code"
    # Download non-default fonts from Google Fonts when the UI is built. The default
    # fonts ship with hyperglass. When this is off, a non-default font is linked from
    # Google Fonts, so visitors' browsers fetch it from Google.
    download: bool = False


class Theme(HyperglassModel):
    """Validation model for theme variables."""

    colors: ThemeColors = ThemeColors()
    default_color_mode: t.Optional[ColorMode] = None
    fonts: ThemeFonts = ThemeFonts()


class DnsOverHttps(HyperglassModel):
    """Validation model for DNS over HTTPS resolution."""

    name: str = "cloudflare"
    url: str = ""

    @model_validator(mode="before")
    def validate_dns(cls, data: "DnsOverHttps") -> t.Dict[str, str]:
        """Assign url field to model based on selected provider."""
        name = data.get("name", "cloudflare")
        url = data.get("url", DNS_OVER_HTTPS["cloudflare"])
        if url not in DNS_OVER_HTTPS.values():
            return {
                "name": "custom",
                "url": url,
            }
        if name not in DNS_OVER_HTTPS:
            known = ", ".join(DNS_OVER_HTTPS)
            raise ValueError(
                f"web.dns_provider: {name!r} is not a known provider. "
                f"Use one of: {known}, or set 'url' to a custom DNS over HTTPS URL "
                "('url' is required with 'custom')."
            )
        url = DNS_OVER_HTTPS[name]
        return {
            "name": name,
            "url": url,
        }


class HighlightPattern(HyperglassModel):
    """Validation model for highlight pattern configuration."""

    pattern: str
    label: t.Optional[str] = None
    color: str = "primary"

    @field_validator("color")
    def validate_color(cls: "HighlightPattern", value: str) -> str:
        """Ensure highlight color is a valid theme color."""
        colors = list(ThemeColors.model_fields.keys())
        color_list = "\n  - ".join(("", *colors))
        if value not in colors:
            raise ValueError(
                "{!r} is not a supported color. Must be one of:{!s}".format(value, color_list)
            )
        return value


class ClientIP(HyperglassModel):
    """How Hyperglass identifies the visitor behind reverse proxies or a CDN."""

    # Optional single-address header overwritten by a trusted proxy. Otherwise use
    # the X-Forwarded-For chain. No fallback to other client-supplied headers.
    header: t.Optional[str] = None
    # Empty means trust no forwarding headers. List only actual connecting proxies.
    trusted_proxies: t.List[IPvAnyNetwork] = []

    @field_validator("header")
    @classmethod
    def validate_header(cls, value: t.Optional[str]) -> t.Optional[str]:
        """Normalise the header name, and reject a value that is not a header name."""
        if value is None or not value.strip():
            return None
        value = value.strip().lower()
        if not HEADER_NAME_PATTERN.fullmatch(value):
            raise ValueError(f"'{value}' is not a valid HTTP header name")
        return value


class LookupQuota(HyperglassModel):
    """Requests per minute allowed to one client and to all clients together.

    Clients are counted per IPv4 address and per IPv6 /64, so one host cannot multiply
    its quota by rotating through the addresses of its prefix.
    """

    client_limit: PositiveInt
    global_limit: PositiveInt


class ServerDnsLookups(LookupQuota):
    """Server-side hostname resolution through `/api/dns`."""

    # DNS-over-HTTPS JSON endpoint the server asks. Default: Cloudflare's public resolver.
    resolver: HttpUrl = HttpUrl("https://1.1.1.1/dns-query")
    client_limit: PositiveInt = 120
    global_limit: PositiveInt = 600


class ServerAsPathLookups(LookupQuota):
    """ASN name lookups through `/api/aspath/enrich`."""

    client_limit: PositiveInt = 30
    global_limit: PositiveInt = 120


class ServerLookups(HyperglassModel):
    """Bounds for the optional lookups the server makes for the UI.

    Covers `/api/dns` (`dns_provider.name: server`) and `/api/aspath/enrich`
    (`aspath_enrichment: true`). The WHOIS server for AS path lookups is set by
    `structured.ip_enrichment.whois_host` and `whois_port`.
    """

    # Seconds allowed for one outbound lookup. Whole seconds, because the outbound
    # lease that bounds concurrency expires in seconds.
    timeout: PositiveInt = 5
    # Outbound lookups in flight at once, shared by every worker and both endpoints.
    max_concurrent: PositiveInt = 8
    dns: ServerDnsLookups = ServerDnsLookups()
    aspath: ServerAsPathLookups = ServerAsPathLookups()


class Web(HyperglassModel):
    """Validation model for all web/browser-related configuration."""

    credit: Credit = Credit()
    dns_provider: DnsOverHttps = DnsOverHttps()
    links: t.Sequence[Link] = [
        Link(title="PeeringDB", url="https://www.peeringdb.com/asn/{primary_asn}")
    ]
    menus: t.Sequence[Menu] = [
        Menu(title="Terms", content=DEFAULT_TERMS),
        Menu(title="Help", content=DEFAULT_HELP),
    ]
    greeting: Greeting = Greeting()
    logo: Logo = Logo()
    opengraph: OpenGraph = OpenGraph()
    text: Text = Text()
    theme: Theme = Theme()
    history: History = History()
    location_display_mode: LocationDisplayMode = "auto"
    # `external` looks up the visitor's address with myip.wtf, `server` reads it from the
    # request to Hyperglass, and `off` hides the My IP button.
    my_ip: t.Literal["external", "server", "off"] = "server"
    client_ip: ClientIP = ClientIP()
    aspath_enrichment: bool = False
    server_lookups: ServerLookups = ServerLookups()
    custom_javascript: t.Optional[FilePath] = None
    custom_html: t.Optional[FilePath] = None
    highlight: t.List[HighlightPattern] = []

    @model_validator(mode="after")
    def validate_fqdn_message(self) -> "Web":
        """Describe server-side resolution, unless the message was customised."""
        default = Text.model_fields["fqdn_message"].default
        if self.dns_provider.name == "server" and self.text.fqdn_message == default:
            self.text.fqdn_message = "Hyperglass has resolved {fqdn} to"
        return self


class WebPublic(Web):
    """Public web configuration."""

    logo: LogoPublic
    # Proxy settings are used by the server only, so the UI never receives them.
    client_ip: ClientIP = Field(default_factory=ClientIP, exclude=True)
    server_lookups: ServerLookups = Field(default_factory=ServerLookups, exclude=True)
