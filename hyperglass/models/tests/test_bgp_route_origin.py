"""BGPRoute reports the same origin AS on every platform."""

# Third Party
import pytest

# Project
from hyperglass.state import use_state
from hyperglass.models.data.bgp_route import BGPRoute

ROUTE = {
    "prefix": "192.0.2.0/24",
    "active": True,
    "age": 1,
    "weight": 0,
    "med": 0,
    "local_preference": 100,
    "communities": [],
    "next_hop": "198.51.100.1",
    "source_rid": "",
    "peer_rid": "",
    "rpki_state": 3,
}


@pytest.mark.parametrize(
    "as_path,supplied,expected",
    [
        pytest.param([64500, 64501, 64502], 0, 64502, id="last-asn"),
        # An aggregator or neighbour AS from the parser never overrides the path.
        pytest.param([64500, 64501], 64500, 64501, id="ignores-parser-value"),
        # Empty path: a local ASN the parser supplied (e.g. the router's own AS) wins.
        pytest.param([], 64999, 64999, id="empty-path-parser-local-asn"),
    ],
)
def test_origin_is_last_asn_in_path(as_path, supplied, expected):
    route = BGPRoute(**ROUTE, as_path=as_path, source_as=supplied)
    assert route.source_as == expected


def test_empty_path_without_local_asn_uses_primary_asn():
    route = BGPRoute(**ROUTE, as_path=[])
    assert route.source_as == int(use_state("params").primary_asn)


def test_unknown_as_path_has_no_origin():
    """`None` from the parser: the output held no AS path, so the origin is unknown."""
    route = BGPRoute(**ROUTE, as_path=[], source_as=None)
    assert route.source_as == 0
