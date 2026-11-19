"""Tests for bgp.tools WHOIS parsing, address filtering and cache reporting."""

# Standard Library
from unittest.mock import Mock, AsyncMock

# Third Party
import pytest

# Project
from hyperglass.external import ip_enrichment

PIPE_RESPONSE = b"""AS      | IP       | BGP Prefix | CC | Registry | Allocated  | AS Name
13335   | 1.1.1.1  | 1.1.1.0/24 | US | ARIN     | 2010-07-14 | Cloudflare, Inc.
15169   | 2001:4860:4860::8888 | 2001:4860::/32 | US | ARIN | 2005-03-14 | Google LLC
206924  |          |            | GB | RIPE     | 2017-04-11 | Example Org
"""

WHITESPACE_RESPONSE = b"""13335 1.1.1.1 1.1.1.0/24 Cloudflare, Inc.
15169 2001:4860:4860::8888 2001:4860::/32 Google LLC
"""

EXPECTED = {
    "1.1.1.1": (13335, "Cloudflare, Inc.", "1.1.1.0/24"),
    "2001:4860:4860::8888": (15169, "Google LLC", "2001:4860::/32"),
}


def whois_server(monkeypatch, response: bytes) -> Mock:
    """Replace the WHOIS socket with one that returns `response`."""
    connection = Mock()
    connection.__enter__ = Mock(return_value=connection)
    connection.__exit__ = Mock(return_value=False)
    connection.recv.side_effect = [response, b""]
    create = Mock(return_value=connection)
    monkeypatch.setattr(ip_enrichment.socket, "create_connection", create)
    return create


async def query(service, addresses, bulk):
    """Run a lookup through either the single or the bulk WHOIS path."""
    if bulk:
        return await service._query_bgp_tools_bulk(addresses)
    return {address: await service._query_bgp_tools_for_ip(address) for address in addresses}


@pytest.mark.asyncio
@pytest.mark.parametrize("bulk", [False, True], ids=["single", "bulk"])
@pytest.mark.parametrize(
    "response", [PIPE_RESPONSE, WHITESPACE_RESPONSE], ids=["pipe", "whitespace"]
)
async def test_both_paths_parse_both_whois_formats(monkeypatch, bulk, response):
    service = ip_enrichment.IPEnrichmentService()
    for address, expected in EXPECTED.items():
        whois_server(monkeypatch, response)
        assert await query(service, [address], bulk) == {address: expected}


@pytest.mark.asyncio
@pytest.mark.parametrize("bulk", [False, True], ids=["single", "bulk"])
async def test_both_paths_send_the_same_bulk_request(monkeypatch, bulk):
    create = whois_server(monkeypatch, PIPE_RESPONSE)
    await query(ip_enrichment.IPEnrichmentService(), ["1.1.1.1"], bulk)
    host, timeout = create.call_args.args[0], create.call_args.kwargs["timeout"]
    assert host == ("bgp.tools", 43)
    assert timeout == (15 if bulk else 10)
    sent = create.return_value.sendall.call_args.args[0]
    assert sent == b"begin\n1.1.1.1\nend\n"


def test_asn_rows_are_indexed_by_asn():
    parsed = ip_enrichment.parse_whois_response(PIPE_RESPONSE.decode())
    assert parsed["AS206924"] == parsed["206924"] == (206924, "Example Org", None)
    assert ip_enrichment._map_whois_results(["206924", "AS206924", "AS64500"], parsed) == {
        "206924": (206924, "Example Org", None),
        "AS206924": (206924, "Example Org", None),
        "AS64500": ip_enrichment.NO_RESULT,
    }


def test_malformed_asn_does_not_break_parsing():
    raw = "Vendor: Intel\n² | 1.1.1.1 | 1.1.1.0/24 | x\n"
    assert ip_enrichment.parse_whois_response(raw) == {"1.1.1.1": (None, "x", "1.1.1.0/24")}


@pytest.mark.asyncio
async def test_asn_bulk_lookup_reads_asn_rows(monkeypatch):
    monkeypatch.setattr(ip_enrichment, "_service", ip_enrichment.IPEnrichmentService())
    whois_server(monkeypatch, PIPE_RESPONSE)
    result = await ip_enrichment.lookup_asns_bulk(["206924"])
    assert result == {"206924": {"name": "Example Org", "country": ""}}


@pytest.mark.asyncio
async def test_connection_failure_returns_no_result(monkeypatch):
    monkeypatch.setattr(
        ip_enrichment.socket, "create_connection", Mock(side_effect=OSError("refused"))
    )
    service = ip_enrichment.IPEnrichmentService()
    assert await service._query_bgp_tools_bulk(["1.1.1.1", "AS13335"]) == {
        "1.1.1.1": ip_enrichment.NO_RESULT,
        "AS13335": ip_enrichment.NO_RESULT,
    }


NON_ROUTABLE = [
    "0.0.0.0",  # noqa: S104 - a lookup target, not a bind address
    "::",
    "224.0.0.1",
    "239.1.1.1",
    "ff02::1",
    "ff0e::1",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("address", NON_ROUTABLE)
async def test_unspecified_and_multicast_addresses_are_not_looked_up(monkeypatch, address):
    service = ip_enrichment.IPEnrichmentService()
    bulk = AsyncMock(side_effect=AssertionError("sent to bgp.tools"))
    single = AsyncMock(side_effect=AssertionError("sent to bgp.tools"))
    monkeypatch.setattr(service, "_query_bgp_tools_bulk", bulk)
    monkeypatch.setattr(service, "_query_bgp_tools_for_ip", single)

    assert (await service.lookup_ips_bulk([address]))[address].asn == 0
    assert (await service.lookup_ip(address)).asn == 0
    default_data, query_targets = ip_enrichment.default_ip_targets(address)
    assert query_targets == []
    assert address in default_data


def test_public_addresses_are_still_looked_up():
    _, query_targets = ip_enrichment.default_ip_targets("1.1.1.1", "2606:4700:4700::1111")
    assert query_targets == ["1.1.1.1", "2606:4700:4700::1111"]


def test_data_status_reports_the_ttl_cache(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(ip_enrichment.time, "monotonic", lambda: now[0])
    service = ip_enrichment.IPEnrichmentService()
    monkeypatch.setattr(ip_enrichment, "_service", service)
    service._cache_ip("1.1.1.1", (13335, "Cloudflare, Inc.", None))
    now[0] += ip_enrichment.IP_CACHE_TTL - 1
    service._cache_ip("8.8.8.8", (15169, "Google LLC", None))

    status = ip_enrichment.get_data_status()
    assert status["cache_enabled"] is True
    assert status["cache_ttl"] == ip_enrichment.IP_CACHE_TTL == 300
    assert status["data_counts"]["cached_ips"] == 2

    now[0] += 2
    assert ip_enrichment.get_data_status()["data_counts"]["cached_ips"] == 1
