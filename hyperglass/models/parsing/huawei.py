"""Data Models for Parsing Huawei Response."""

# Standard Library
import re
import typing as t

# Third Party
from pydantic import ConfigDict

# Project
from hyperglass.log import log
from hyperglass.models.data import BGPRouteTable

# Local
from ..main import HyperglassModel

RPKI_STATE_MAP = {
    "invalid": 0,
    "valid": 1,
    "not-found": 2,
}

WINNING_WEIGHT = "high"

HuaweiPathType = t.Literal["external", "internal", "local"]

HuaweiRPKIState = t.Literal["valid", "invalid", "not-found"]


class _HuaweiBase(HyperglassModel):
    """Base Model for Huawei validation."""

    model_config = ConfigDict(extra="ignore")


class HuaweiRoutePath(_HuaweiBase):
    """Validation model for Huawei BGP route path."""

    prefix: str
    peer_address: str
    peer_rid: str
    duration: str
    next_hop: str
    relay_next_hop: t.Optional[str]
    out_intf: str
    qos_info: str
    communities: t.Optional[str]
    large_communities: t.Optional[str]
    ext_communities: t.Optional[str]
    as_path: str
    origin: str
    med: t.Optional[int]
    local_preference: t.Optional[int]
    preference_value: int
    path_type: HuaweiPathType
    is_valid: bool
    is_best: bool
    is_preferred: bool
    route_preference: int
    rpki_state: t.Optional[HuaweiRPKIState]


class HuaweiBGPTable(_HuaweiBase):
    """Validation model for Huawei BGP routing data."""

    router_id: str = ""
    local_asn: int = 0
    vrf: str = "default"
    paths_num_total: int = 0
    paths_num_best: int = 0
    paths_num_selected: int = 0
    paths_num_best_external: int = 0
    paths_num_add_path: int = 0
    bgp_path_entries: list[HuaweiRoutePath] = []

    @staticmethod
    def _get_route_age(duration: str) -> int:
        """Parse duration time as sting and return integer."""
        regex = re.compile(r"(\d+)d(\d+)h(\d+)m(\d+)s")
        match = regex.search(duration)
        if match:
            days, hours, minutes, seconds = [int(n or 0) for n in match.groups()]
            return days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds
        return 0

    @staticmethod
    def _get_as_path(as_path: str) -> list[int]:
        """Convert AS-path string to list of ASNs."""
        if as_path == "Nil":
            return []
        return [int(asn) for asn in as_path.split() if asn.isdecimal()]

    @staticmethod
    def _get_communities(community: str | None) -> list[str]:
        """Convert community string to list of communities."""
        if isinstance(community, str):
            return [c.strip("<>") for c in community.split(", ")]
        return []

    def bgp_table(self: "HuaweiBGPTable") -> BGPRouteTable:
        """Convert the Huawei-formatted fields to standard parsed data model."""
        routes = []
        for route in self.bgp_path_entries:
            as_path = self._get_as_path(as_path=route.as_path)
            rpki_state = RPKI_STATE_MAP.get(route.rpki_state, 3)
            communities = []
            if route.communities:
                communities += self._get_communities(route.communities)
            if route.large_communities:
                communities += self._get_communities(route.large_communities)
            if route.ext_communities:
                communities += self._get_communities(route.ext_communities)

            # iBGP paths contain string "Nil". If the AS_PATH is "Nil", we
            # set the source_as to the router's local-as.
            source_as = self.local_asn
            if len(as_path) != 0:
                source_as = as_path[-1]

            routes.append(
                {
                    "prefix": route.prefix,
                    "active": route.is_best,
                    "age": self._get_route_age(route.duration),
                    "weight": route.preference_value,
                    "med": route.med or 0,
                    "local_preference": route.local_preference or 100,
                    "as_path": as_path,
                    "communities": communities,
                    "next_hop": route.next_hop,
                    "source_as": source_as,
                    "source_rid": route.peer_rid,
                    "peer_rid": route.peer_address,
                    "rpki_state": rpki_state,
                }
            )

        serialized = BGPRouteTable(
            vrf=self.vrf,
            count=self.paths_num_total,
            routes=routes,
            winning_weight=WINNING_WEIGHT,
        )

        log.bind(platform="huawei", response=repr(serialized)).debug("Serialized response")
        return serialized
