"""Tests for structured IP enrichment configuration."""

# Third Party
import pytest

# Project
from hyperglass.models.config.structured import Structured, StructuredIpEnrichment


def test_ip_enrichment_defaults_to_inline() -> None:
    """Keep existing deployments on inline enrichment unless opted in."""
    assert StructuredIpEnrichment().mode == "inline"


def test_ip_enrichment_accepts_async_mode() -> None:
    """Allow asynchronous enrichment to be selected explicitly."""
    assert StructuredIpEnrichment(mode="async").mode == "async"


def test_ip_enrichment_rejects_unknown_mode() -> None:
    """Reject unsupported enrichment execution modes."""
    with pytest.raises(ValueError):
        StructuredIpEnrichment(mode="later")


def test_async_enrichment_recognizes_legacy_cached_output() -> None:
    """Treat structured cache dictionaries without status as enrichment candidates."""
    structured = Structured(
        ip_enrichment=StructuredIpEnrichment(
            mode="async", enrich_bgproute=True, enrich_traceroute=True
        ),
        enable_for_bgp_route=True,
        enable_for_traceroute=True,
    )

    assert structured.is_async_enrichment_enabled({"routes": []})
    assert structured.is_async_enrichment_enabled({"hops": []})
    assert not structured.is_async_enrichment_enabled("123")


def test_ip_enrichment_on_by_default() -> None:
    """Enrich traceroute hops and BGP routes unless the operator opts out."""
    defaults = StructuredIpEnrichment()
    assert defaults.enrich_traceroute is True
    assert defaults.enrich_bgproute is True
    disabled = StructuredIpEnrichment(enrich_traceroute=False, enrich_bgproute=False)
    assert disabled.enrich_traceroute is False
    assert disabled.enrich_bgproute is False


def test_default_enrichment_failure_still_returns_the_output(monkeypatch) -> None:
    """An unreachable enrichment source leaves the parsed output as it was."""
    # Project
    from hyperglass.models.data.bgp_route import BGPRouteTable
    from hyperglass.models.data.traceroute import TracerouteResult
    from hyperglass.plugins._builtin.bgp_route_enrichment import ZBgpRouteEnrichment
    from hyperglass.plugins._builtin.traceroute_ip_enrichment import ZTracerouteIpEnrichment

    calls = []

    async def unreachable(*args, **kwargs):
        calls.append(args)
        raise OSError("unreachable")

    monkeypatch.setattr(ZBgpRouteEnrichment, "enrich", unreachable)
    monkeypatch.setattr(ZTracerouteIpEnrichment, "enrich", unreachable)
    table = BGPRouteTable(vrf="default", routes=[], winning_weight="high")
    trace = TracerouteResult(target="192.0.2.1", source="192.0.2.2", hops=[])
    assert ZBgpRouteEnrichment(name="bgp").process(output=table, query=None) is table
    assert ZTracerouteIpEnrichment(name="trace").process(output=trace, query=None) is trace
    # Both plugins tried to enrich, because enrichment is on by default.
    assert len(calls) == 2
