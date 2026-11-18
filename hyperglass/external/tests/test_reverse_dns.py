"""PTR work is bounded and cannot delay the initial traceroute response."""

import asyncio
import socket
import threading
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from concurrent.futures import ThreadPoolExecutor

import pytest

from hyperglass.external import reverse_dns
from hyperglass.models.data.traceroute import TracerouteResult
from hyperglass.models.config.params import Params
from hyperglass.state import use_state


def trace():
    return TracerouteResult(
        target="192.0.2.4", source="test",
        hops=[
            {"hop_number": 1, "ip_address": "192.0.2.1", "hostname": "supplied.example"},
            {"hop_number": 2, "ip_address": "192.0.2.2"},
            {"hop_number": 3, "ip_address": "192.0.2.2"},
            {"hop_number": 4, "ip_address": "192.0.2.3"},
        ],
    )


@pytest.mark.asyncio
async def test_ptr_deduplicates_missing_hosts_and_preserves_router_names(monkeypatch):
    calls = []

    def lookup(address):
        calls.append(address)
        if address == "192.0.2.3":
            raise socket.herror("no PTR")
        return "resolved.example", [], [address]

    monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
    output = trace()
    await reverse_dns.enrich_hostnames(output)
    assert sorted(calls) == ["192.0.2.2", "192.0.2.3"]
    assert [hop.hostname for hop in output.hops] == [
        "supplied.example", "resolved.example", "resolved.example", None,
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
        monkeypatch.setattr(reverse_dns, "PTR_LOOKUP_TIMEOUT", 0.02)
        monkeypatch.setattr(reverse_dns.socket, "gethostbyaddr", lookup)
        try:
            assert await reverse_dns.lookup_hostname("192.0.2.2") is None
            assert started.is_set()
            # The timed-out libc call still holds the only slot.
            assert await reverse_dns.lookup_hostname("192.0.2.3") is None
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
    monkeypatch.setattr(reverse_dns, "PTR_QUERY_TIMEOUT", 0.02)
    output = trace()
    async with asyncio.timeout(1):
        await reverse_dns.enrich_hostnames(output)
    assert finished.is_set()
    assert output.hops[1].hostname is None


@pytest.mark.asyncio
async def test_response_precedes_ptr_and_poll_receives_enriched_cache(monkeypatch):
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
        summary=lambda: "trace", digest=lambda: "a" * 64, timestamp=datetime.now(UTC),
        random=lambda: "random", device=SimpleNamespace(structured_output=True),
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
