"""PTR work is bounded and cannot delay the initial traceroute response."""

# Standard Library
import socket
import asyncio
import threading
from types import SimpleNamespace
from datetime import UTC, datetime
from unittest.mock import Mock, AsyncMock
from concurrent.futures import ThreadPoolExecutor

# Third Party
import pytest

# Project
from hyperglass.state import use_state
from hyperglass.external import reverse_dns
from hyperglass.models.config.params import Params
from hyperglass.models.data.traceroute import TracerouteResult


def set_reverse_dns(**config):
    use_state().cache.set("params", Params(structured={"ip_enrichment": {"reverse_dns": config}}))


def trace():
    return TracerouteResult(
        target="1.1.1.1",
        source="test",
        hops=[
            {"hop_number": 1, "ip_address": "1.1.1.1", "hostname": "supplied.example"},
            {"hop_number": 2, "ip_address": "8.8.8.8"},
            {"hop_number": 3, "ip_address": "8.8.8.8"},
            {"hop_number": 4, "ip_address": "9.9.9.9"},
        ],
    )


@pytest.mark.asyncio
async def test_ptr_deduplicates_missing_hosts_and_preserves_router_names(monkeypatch):
    calls = []

    def lookup(address):
        calls.append(address)
        if address == "9.9.9.9":
            raise socket.herror("no PTR")
        return "resolved.example", [], [address]

    monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
    output = trace()
    await reverse_dns.enrich_hostnames(output)
    assert sorted(calls) == ["8.8.8.8", "9.9.9.9"]
    assert [hop.hostname for hop in output.hops] == [
        "supplied.example",
        "resolved.example",
        "resolved.example",
        None,
    ]


@pytest.mark.asyncio
async def test_slow_resolver_has_no_unbounded_queue(monkeypatch):
    release = threading.Event()
    started = threading.Event()

    def lookup(address):
        started.set()
        release.wait(2)
        return "late.example", [], [address]

    with ThreadPoolExecutor(max_workers=1) as executor:
        monkeypatch.setattr(reverse_dns, "_executor", executor)
        monkeypatch.setattr(reverse_dns, "_slots", threading.BoundedSemaphore(1))
        set_reverse_dns(lookup_timeout=0.02)
        monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
        try:
            assert await reverse_dns.lookup_hostname("8.8.8.8") is None
            assert started.is_set()
            # The timed-out libc call still holds the only slot.
            assert await reverse_dns.lookup_hostname("9.9.9.9") is None
            assert executor._work_queue.qsize() == 0
        finally:
            release.set()


@pytest.mark.asyncio
async def test_entire_ptr_batch_has_a_deadline(monkeypatch):
    finished = asyncio.Event()

    async def never_finishes(address):
        try:
            await asyncio.Event().wait()
        finally:
            finished.set()

    monkeypatch.setattr(reverse_dns, "lookup_hostname", never_finishes)
    set_reverse_dns(query_timeout=0.02)
    output = trace()
    async with asyncio.timeout(1):
        await reverse_dns.enrich_hostnames(output)
    assert finished.is_set()
    assert output.hops[1].hostname is None


@pytest.mark.asyncio
async def test_response_precedes_ptr_and_poll_receives_enriched_cache(monkeypatch):
    # Project
    from hyperglass.api import routes

    state = use_state()
    state.cache.set("params", Params(structured={"ip_enrichment": {"enrich_traceroute": True}}))
    output = trace()
    monkeypatch.setattr(routes, "_execute_query", AsyncMock(return_value=output))
    lookup = AsyncMock(return_value="resolved.example")
    monkeypatch.setattr(reverse_dns, "lookup_hostname", lookup)
    # Inline IP/ASN enrichment already completed before this background phase.
    enrich_ip = AsyncMock(side_effect=AssertionError("Repeated inline enrichment"))
    monkeypatch.setattr(TracerouteResult, "enrich_with_ip_enrichment", enrich_ip)
    query = SimpleNamespace(
        summary=lambda: "trace",
        digest=lambda: "a" * 64,
        timestamp=datetime.now(UTC),
        random=lambda: "random",
        force=False,
        query_variables={},
        _validated_target="192.0.2.1",
        device=SimpleNamespace(structured_output=True, id="test", name="Test"),
        directive=SimpleNamespace(id="traceroute", name="Traceroute"),
    )
    response = await routes.query.fn(state, SimpleNamespace(), query)
    assert response.content["enrichment"] == "pending"
    assert response.content["output"]["hops"][1]["hostname"] is None
    lookup.assert_not_awaited()
    await response.background()
    cached = await routes.query_enrichment.fn(response.content["id"])
    assert cached["status"] == "complete"
    assert cached["output"]["hops"][1]["hostname"] == "resolved.example"
    enrich_ip.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "address",
    [
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.1.1",
        "100.64.0.1",
        "192.0.2.1",
        "0.0.0.0",  # noqa: S104 (PTR input)
        "224.0.0.1",
        "240.0.0.1",
        "::",
        "::1",
        "fc00::1",
        "fe80::1",
        "fec0::1",
        "ff02::1",
        "2001:db8::1",
        "::ffff:10.0.0.1",
        "not-an-address",
    ],
)
async def test_nonpublic_hops_never_reach_resolver(monkeypatch, address):
    lookup = Mock(side_effect=AssertionError("Internal DNS lookup"))
    monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
    output = SimpleNamespace(hops=[SimpleNamespace(ip_address=address, hostname=None)])
    assert reverse_dns._missing_addresses(output) == {}
    await reverse_dns.enrich_hostnames(output)
    assert await reverse_dns.lookup_hostname(address) is None
    lookup.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "address,canonical",
    [
        ("2606:4700:4700::1111", "2606:4700:4700::1111"),
        ("::ffff:8.8.8.8", "8.8.8.8"),
    ],
)
async def test_public_ipv6_and_mapped_hops_resolve(monkeypatch, address, canonical):
    lookup = Mock(return_value=("public.example", [], [canonical]))
    monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
    output = SimpleNamespace(hops=[SimpleNamespace(ip_address=address, hostname=None)])
    await reverse_dns.enrich_hostnames(output)
    assert output.hops[0].hostname == "public.example"
    lookup.assert_called_once_with(canonical)


@pytest.mark.asyncio
async def test_ptr_limits_come_from_configuration(monkeypatch):
    calls = []

    def lookup(address):
        calls.append(address)
        return "resolved.example", [], [address]

    monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
    monkeypatch.setattr(reverse_dns, "_executor", None)
    monkeypatch.setattr(reverse_dns, "_slots", None)
    set_reverse_dns(workers=2, max_addresses=1)
    output = trace()
    await reverse_dns.enrich_hostnames(output)
    assert calls == ["8.8.8.8"]
    assert reverse_dns._executor._max_workers == 2
