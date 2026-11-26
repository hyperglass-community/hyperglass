"""Constant definitions used throughout the application."""

# Standard Library
from datetime import datetime

__name__ = "hyperglass"
__version__ = "3.0.0rc3"
__author__ = "Matt Love"
__copyright__ = f"Copyright {datetime.now().year} Matthew Love"
__license__ = "BSD 3-Clause Clear License"

# Compatibility metadata retained for existing API consumers.
__upstream_version__ = "2.0.4"
__upstream_url__ = "https://github.com/hyperglass-community/hyperglass"

METADATA = (__name__, __version__, __author__, __copyright__, __license__)

MIN_PYTHON_VERSION = (3, 11)

MIN_NODE_VERSION = (22, 13)

TARGET_FORMAT_SPACE = ("huawei", "huawei_vrpv8")

TARGET_JUNIPER_ASPATH = ("juniper", "juniper_junos")

# Additional parsers become supported with their directives and tests.
SUPPORTED_STRUCTURED_OUTPUT = (
    "frr",
    "juniper",
    "arista_eos",
    "juniper_junos",
    "huawei",
    "huawei_vrpv8",
    "mikrotik_routeros",
    "mikrotik_switchos",
    "cisco_ios",
    "cisco_xr",
    "cisco_nxos",
    "bird",
    "openbgpd",
    "vyos",
    "arrcus_arcos",
    "aruba_aoscx",
    "cumulus_linux",
    "dell_force10",
    "dell_os10",
    "extreme_exos",
    "fortinet",
    "hp_comware",
    "ipinfusion_ocnos",
    "paloalto_panos",
    "sonic",
    "nokia_sros",
    "vyos_1_3",
    "tnsr",
    "extreme_vsp",
)

CONFIG_EXTENSIONS = ("py", "yaml", "yml", "json", "toml")

STATUS_CODE_MAP = {"warning": 400, "error": 400, "danger": 500}

DNS_OVER_HTTPS = {
    "google": "https://dns.google/resolve",
    "cloudflare": "https://cloudflare-dns.com/dns-query",
    "server": "/api/dns",
}

PARSED_RESPONSE_FIELDS = (
    ("Prefix", "prefix", "left"),
    ("Active", "active", None),
    ("RPKI State", "rpki_state", "center"),
    ("AS Path", "as_path", "left"),
    ("Next Hop", "next_hop", "left"),
    ("Origin", "source_as", None),
    ("Weight", "weight", "center"),
    ("Local Preference", "local_preference", "center"),
    ("MED", "med", "center"),
    ("Communities", "communities", "center"),
    ("Originator", "source_rid", "right"),
    ("Peer", "peer_rid", "right"),
    ("Age", "age", "right"),
)

SUPPORTED_QUERY_FIELDS = ("query_location", "query_type", "query_target", "query_vrf")
SUPPORTED_QUERY_TYPES = (
    "bgp_route",
    "bgp_community",
    "bgp_aspath",
    "ping",
    "traceroute",
)

FUNC_COLOR_MAP = {
    "primary": "cyan",
    "secondary": "blue",
    "success": "green",
    "warning": "yellow",
    "error": "orange",
    "danger": "red",
}

TRANSPORT_REST = ("frr_legacy", "bird_legacy")

SCRAPE_HELPERS = {
    "arista": "arista_eos",
    "ios": "cisco_ios",
    "juniper_junos": "juniper",
    "junos": "juniper",
    "mikrotik": "mikrotik_routeros",
    "tsnr": "tnsr",
    "arcos": "arrcus_arcos",
}

# Connection drivers a device may set with `driver`. The `SupportedDriver` config type
# and the driver allowlist are both derived from this tuple.
SUPPORTED_DRIVERS = ("netmiko", "hyperglass_http_client")

DRIVER_MAP = {
    "bird": "netmiko",
    "frr": "netmiko",
    "openbgpd": "netmiko",
    "sonic": "netmiko",
    "vyos_1_3": "netmiko",
    "tnsr": "netmiko",
    "arrcus_arcos": "netmiko",
    "http": "hyperglass_http_client",
}

# Platforms with their own built-in directives that use another Netmiko device type.
NETMIKO_DEVICE_TYPES = {
    "vyos_1_3": "vyos",
    # Netmiko has no TNSR driver. Its generic driver finds the `tnsr#` prompt per command and
    # sends no paging command.
    "tnsr": "generic",
}

LINUX_PLATFORMS = (
    "frr",
    "bird",
    "openbgpd",
    "sonic",
    "arrcus_arcos",
)

# Platforms whose commands a POSIX shell parses: Netmiko's `linux_ssh` family, VyOS
# operational mode, and TNSR's `dataplane shell`. Command arguments are quoted on these
# platforms. Netmiko's `_ssh` aliases name the same device types, so each is included.
_SHELL_PLATFORMS = (
    *LINUX_PLATFORMS,
    "linux",
    "cumulus_linux",
    "corelight_linux",
    "edgecore_sonic",
    "f5_linux",
    "ovs_linux",
    "cisco_apic",
    "vyos",
    "vyos_1_3",
    "brocade_vyos",
    "vyatta_vyos",
    "ubiquiti_edgerouter",
    "tnsr",
)
SHELL_PLATFORMS = frozenset((*_SHELL_PLATFORMS, *(f"{p}_ssh" for p in _SHELL_PLATFORMS)))
