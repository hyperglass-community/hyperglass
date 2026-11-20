"""Juniper text and table directives send the same community argument."""

# Standard Library
from types import SimpleNamespace

# Third Party
import pytest

# Project
from hyperglass.defaults.directives.juniper import JuniperBGPCommunity, JuniperBGPCommunityTable

# Local
from .._construct import Construct


def commands(directive, target):
    # Validation marks rules as passed, so use a copy of the shared built-in.
    directive = directive.model_copy(deep=True)
    device = SimpleNamespace(platform="juniper", name="test", attrs={})
    query = SimpleNamespace(
        device=device, directive=directive, query_type=directive.id, query_target=target
    )
    return Construct(device, query).queries()


@pytest.mark.parametrize(
    "target", ("65000:1", "target:65000:4294967295", "origin:192.0.2.1:100", "4200000000:1:2")
)
def test_text_and_table_quote_the_community_the_same_way(target):
    text = commands(JuniperBGPCommunity, target)
    table = commands(JuniperBGPCommunityTable, target)
    assert text == [
        f'show route protocol bgp table inet.0 community "{target}" detail',
        f'show route protocol bgp table inet6.0 community "{target}" detail',
    ]
    assert table == [f"{command} | display xml" for command in text]
