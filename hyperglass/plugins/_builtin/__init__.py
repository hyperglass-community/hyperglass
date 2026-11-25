"""Built-in hyperglass plugins."""

# Local
from .bgp_route_frr import BGPRoutePluginFrr
from .bgp_route_bird import BGPRoutePluginBird
from .bgp_route_dell import BGPRoutePluginDell
from .remove_command import RemoveCommand
from .bgp_route_aoscx import BGPRoutePluginAOSCX
from .bgp_route_arcos import BGPRoutePluginArcOS
from .bgp_route_ocnos import BGPRoutePluginOcNOS
from .bgp_route_panos import BGPRoutePluginPANOS
from .trace_route_frr import TraceroutePluginFrr
from .trace_route_os9 import TraceroutePluginOS9
from .bgp_route_arista import BGPRoutePluginArista
from .bgp_route_huawei import BGPRoutePluginHuawei
from .bgp_route_comware import BGPRoutePluginComware
from .bgp_route_juniper import BGPRoutePluginJuniper
from .bgp_route_fortinet import BGPRoutePluginFortinet
from .bgp_route_openbgpd import BGPRoutePluginOpenBGPD
from .trace_route_huawei import TraceroutePluginHuawei
from .bgp_route_cisco_ios import BGPRoutePluginCiscoIOS
from .bgp_routestr_huawei import BGPSTRRoutePluginHuawei
from .bgp_route_enrichment import ZBgpRouteEnrichment
from .trace_route_mikrotik import TraceroutePluginMikrotik
from .trace_route_standard import TraceroutePluginStandard
from .bgp_routestr_mikrotik import BGPSTRRoutePluginMikrotik
from .bgp_route_extreme_exos import BGPRoutePluginExtremeEXOS
from .mikrotik_garbage_output import MikrotikGarbageOutput
from .traceroute_ip_enrichment import ZTracerouteIpEnrichment

__all__ = (
    "BGPRoutePluginArista",
    "BGPRoutePluginBird",
    "BGPRoutePluginCiscoIOS",
    "BGPRoutePluginOpenBGPD",
    "BGPRoutePluginExtremeEXOS",
    "BGPRoutePluginAOSCX",
    "BGPRoutePluginComware",
    "BGPRoutePluginDell",
    "BGPRoutePluginFortinet",
    "BGPRoutePluginOcNOS",
    "BGPRoutePluginPANOS",
    "BGPRoutePluginArcOS",
    "TraceroutePluginOS9",
    "BGPRoutePluginFrr",
    "BGPRoutePluginJuniper",
    "BGPRoutePluginHuawei",
    "BGPSTRRoutePluginHuawei",
    "BGPSTRRoutePluginMikrotik",
    "MikrotikGarbageOutput",
    "TraceroutePluginFrr",
    "TraceroutePluginHuawei",
    "TraceroutePluginMikrotik",
    "TraceroutePluginStandard",
    "ZTracerouteIpEnrichment",
    "ZBgpRouteEnrichment",
    "RemoveCommand",
)
