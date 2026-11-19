"""BIRD BGP route parsing tests, using text captured from the lab BIRD router."""

# Standard Library
from pathlib import Path
from types import SimpleNamespace

# Third Party
import pytest

# Project
from hyperglass.models.data.bgp_route import BGPRouteTable

# Local
from ._fixtures import MockDevice
from .._builtin.bgp_route_bird import BGPRoutePluginBird

FIXTURES = Path(__file__).parent / "fixtures" / "bird-live"


def _process(name: str):
    device = MockDevice(
        name="lab-bird",
        address="127.0.0.1",
        group="Test Network",
        credential={"username": "", "password": ""},
        platform="bird",
        structured_output=True,
        attrs={"source4": "192.0.2.1", "source6": "2001:db8::1"},
    )
    query = type("Query", (), {"device": device})
    return BGPRoutePluginBird().process(output=((FIXTURES / name).read_text(),), query=query)


@pytest.mark.parametrize(
    "name,prefix,count",
    (("route4.txt", "1.1.1.0/24", 13), ("route6.txt", "2606:4700::/44", 11)),
)
def test_bird_route(name, prefix, count):
    result = _process(name)

    assert isinstance(result, BGPRouteTable)
    assert result.count == count
    assert {route.prefix for route in result.routes} == {prefix}
    assert sum(route.active for route in result.routes) == 1
    assert all(route.as_path[0] == 65000 and route.next_hop for route in result.routes)
    assert result.routes[0].communities


@pytest.mark.parametrize("name", ("aspath4.txt", "community4.txt"))
def test_bird_filtered_routes(name):
    result = _process(name)

    assert len({route.prefix for route in result.routes}) == 5
    if name == "aspath4.txt":
        assert all(13335 in route.as_path for route in result.routes)
    else:
        assert all("37195:302" in route.communities for route in result.routes)


def test_bird_large_community_and_med():
    route = _process("large_community.txt").routes[0]

    assert route.communities == ["65000:100", "65000:1:1"]
    assert route.med == 5
    assert route.as_path == [65000]


def test_bird_empty_result():
    assert _process("empty.txt") is None


@pytest.mark.parametrize("kind", ["bgp_route", "bgp_aspath", "bgp_community"])
@pytest.mark.parametrize(
    "text", ["BIRD 1.6.8 ready.\n", "BIRD 2.16.1 ready.\nTable master4:\n", ""]
)
def test_bird_text_empty_reply_is_not_a_banner(kind, text):
    device = MockDevice(
        name="bird", address="192.0.2.1", platform="bird", structured_output=False,
        credential={"username": "lg", "password": ""},
        attrs={"source4": "192.0.2.1", "source6": "2001:db8::1"},
    )
    plugin = BGPRoutePluginBird()
    assert f"__hyperglass_bird_{kind}__" in plugin.directives
    assert plugin.process(output=(text,), query=SimpleNamespace(device=device)) is None


@pytest.mark.parametrize("name", ["route4.txt", "route6.txt", "aspath4.txt", "community4.txt"])
def test_bird_text_routes_are_preserved(name):
    device = SimpleNamespace(
        platform="bird", structured_output=False, has_directives=lambda *args: True,
    )
    output = ((FIXTURES / name).read_text(),)
    result = BGPRoutePluginBird().process(output=output, query=SimpleNamespace(device=device))
    assert result == output


def test_bird_unrecognized_text_is_not_discarded():
    device = SimpleNamespace(
        platform="bird", structured_output=False, has_directives=lambda *args: True,
    )
    output = ("BIRD 2.0.7 ready.\nAccess denied",)
    result = BGPRoutePluginBird().process(output=output, query=SimpleNamespace(device=device))
    assert result == output
