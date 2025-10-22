"""Huawei buildin plugins."""

# Standard Library
import re
import typing as t
from ipaddress import ip_network

# Third Party
from pydantic import PrivateAttr, ValidationError

# Project
from hyperglass.log import log
from hyperglass.exceptions.private import ParsingError
from hyperglass.models.parsing.huawei import HuaweiBGPTable

# Local
from .._input import InputPlugin
from .._output import OutputPlugin

if t.TYPE_CHECKING:
    # Project
    from hyperglass.models.api.query import Query
    from hyperglass.models.data import OutputDataModel

    # Local
    from .._output import OutputType

InputPluginTransformReturn = t.Union[t.Sequence[str], str]


HUAWEI_BGP_HEADER_REGEX = (
    r" BGP local router ID : (?P<router_id>\S+)\n"
    r" Local AS number : (?P<local_asn>\d+)\n.*?"
    r" Paths:   (?P<paths_num_total>\d+) available, (?P<paths_num_best>\d+) best,"
    r" (?P<paths_num_selected>\d+) select, (?P<paths_num_best_external>\d+) best-external,"
    r" (?P<paths_num_add_path>\d+) add-path"
)
HUAWEI_BGP_PATH_REGEX = (
    r"BGP routing table entry information of (?P<prefix>\S+):.+?"
    r"From: (?P<peer_address>\S+) \((?P<peer_rid>\S+)\).+?"
    r"Route Duration: (?P<duration>\S+).+?"
    r"(?: Relay IP Nexthop: (?P<relay_next_hop>\S+))?.+?"
    r"(?:Relay IP|Direct) Out-[Ii]nterface: (?P<out_intf>\S+).+?"
    r"Original nexthop: (?P<next_hop>\S+).+?"
    r"Qos information : (?P<qos_info>\S+).+?"
    r"(?: Community: (?P<communities>[<>\d:, ]+)\n)?"
    r"(?: Large-Community: (?P<large_communities>[<>\d:, ]+)\n)?"
    r"(?: Ext-Community: (?P<ext_communities>[\S ]+)\n)?"
    r" AS-path (?P<as_path>[\w ]+), origin (?P<origin>\S+), "
    r"(?:MED (?P<med>\d+), )?(?:localpref (?P<local_preference>\d+), )?"
    r"pref-val (?P<preference_value>\d+), (?:(?P<is_valid>valid), )?"
    r"(?P<path_type>(?:external|internal|local)), (?:(?P<is_best>best), )?"
    r"(?:(?P<is_preferred>select), )?pre (?P<route_preference>\d+).*?"
)


def parse_bgp_route_header_huawei(output: str) -> dict[str, str | None] | None:
    """Parse Huawei BGP routing-table header."""
    header = output[: output.index("\n BGP routing table")]
    regex = re.compile(HUAWEI_BGP_HEADER_REGEX, flags=re.DOTALL)
    match_iter = regex.finditer(header)
    for match in match_iter:
        return match.groupdict()
    return None


def parse_bgp_path_entries_huawei(output: str) -> list[dict[str, str | None]]:
    """Parse Huawei BGP routing-table entries."""
    routes: list[dict[str, str | None]] = []
    regex = re.compile(HUAWEI_BGP_PATH_REGEX, flags=re.DOTALL)
    match_iter = regex.finditer(output)
    for match in match_iter:
        route = match.groupdict()
        route["is_valid"] = True if route["is_valid"] == "valid" else False
        route["is_best"] = True if route["is_best"] == "best" else False
        route["is_preferred"] = True if route["is_preferred"] == "select" else False
        routes.append(route)
    return routes


def parse_bgp_route_output_huawei(response: str):
    """Parse Huawei BGP routing-table response."""
    if "network does not exist" in response:
        return {}

    header = parse_bgp_route_header_huawei(output=response)
    if not header:
        raise ParsingError("Error parsing response data")

    paths = parse_bgp_path_entries_huawei(output=response)
    return {**header, "bgp_path_entries": paths}


def parse_huawei(output: t.Sequence[str]) -> "OutputDataModel":
    """Parse a Arista BGP JSON response."""
    result = None

    _log = log.bind(plugin=BGPRouteTablePluginHuawei.__name__)

    for response in output:
        try:
            parsed: t.Dict = parse_bgp_route_output_huawei(response)

            _log.debug("Parsed data", data=parsed)

            validated = HuaweiBGPTable(**parsed)
            bgp_table = validated.bgp_table()

            if result is None:
                result = bgp_table
            else:
                result += bgp_table

        except ValueError as err:
            _log.critical(err)
            raise ParsingError("Error parsing response data") from err

        except ValidationError as err:
            _log.critical(err)
            raise ParsingError(err.errors()) from err

    return result


class BGPRoutePluginHuawei(InputPlugin):
    _hyperglass_builtin: bool = PrivateAttr(True)
    platforms: t.Sequence[str] = (
        "huawei",
        "huawei_vrpv8",
    )
    directives: t.Sequence[str] = (
        "__hyperglass_huawei_bgp_route__",
        "__hyperglass_huawei_bgp_route_table__",
    )
    """
    Huawei BGP Route Input Plugin

    This plugin transforms a query target into a network address and prefix length
    ex.: 192.0.2.0/24 ->  192.0.2.0 24
    ex.: 2001:db8::/32 -> 2001:db8:: 32
    """

    def transform(self, query: "Query") -> InputPluginTransformReturn:
        target = query.query_target

        if not target or not isinstance(target, list) or len(target) == 0:
            return None

        target = target[0].strip()

        # Check for the / in the query target
        if target.find("/") == -1:
            return target

        target_network = ip_network(target)

        return f"{target_network.network_address!s} {target_network.prefixlen!s}"


class BGPRouteTablePluginHuawei(OutputPlugin):
    """Coerce a Huawei route table string output to a standard BGP Table structure."""

    _hyperglass_builtin: bool = PrivateAttr(True)
    platforms: t.Sequence[str] = (
        "huawei",
        "huawei_vrpv8",
    )
    directives: t.Sequence[str] = ("__hyperglass_huawei_bgp_route_table__",)

    def process(self, *, output: "OutputType", query: "Query") -> "OutputType":
        """Parse Huawei BGP routing-table response if data is a string."""
        should_process = all(
            (
                isinstance(output, (list, tuple)),
                query.device.platform in self.platforms,
                query.device.structured_output is True,
                query.device.has_directives(*self.directives),
            )
        )
        if should_process:
            return parse_huawei(output)
        return output
