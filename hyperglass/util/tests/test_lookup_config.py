"""External lookup endpoints, timeouts and quotas come from configuration (#437)."""

# Standard Library
from unittest.mock import Mock, AsyncMock

# Third Party
import httpx
import pytest
from litestar.testing import create_test_client
from litestar.exceptions import HTTPException

# Project
from hyperglass.state import use_state
from hyperglass.models.config.params import Params
from hyperglass.util.tests.test_client_address import TRUSTED, ProxyRequest

LOOKUPS = {
    "timeout": 3,
    "max_concurrent": 2,
    "dns": {"resolver": "https://doh.example.net/dns-query", "client_limit": 2, "global_limit": 5},
    "aspath": {"client_limit": 2, "global_limit": 4},
}


def configure(**params):
    use_state().redis.set("params", Params(**params))


@pytest.fixture
def lookups(monkeypatch):
    from hyperglass.api import auxiliary

    asns = AsyncMock(return_value={"13335": {"name": "Cloudflare", "country": "US"}})
    monkeypatch.setattr(auxiliary, "_asn_query", asns)
    return asns


def test_defaults_match_previous_behaviour():
    params = Params()
    lookups = params.web.server_lookups
    assert (lookups.timeout, lookups.max_concurrent) == (5, 8)
    assert str(lookups.dns.resolver) == "https://1.1.1.1/dns-query"
    assert (lookups.dns.global_limit, lookups.dns.client_limit) == (600, 120)
    assert (lookups.aspath.global_limit, lookups.aspath.client_limit) == (120, 30)
    enrichment = params.structured.ip_enrichment
    assert (enrichment.whois_host, enrichment.whois_port) == ("bgp.tools", 43)
    assert (enrichment.whois_timeout, enrichment.whois_bulk_timeout) == (10, 15)
    ptr = enrichment.reverse_dns
    assert (ptr.workers, ptr.max_addresses, ptr.lookup_timeout, ptr.query_timeout) == (4, 32, 1, 2)


def test_server_lookups_are_not_sent_to_the_ui():
    from hyperglass.models.config.web import WebPublic

    assert "server_lookups" not in Params(web={"server_lookups": LOOKUPS}).frontend()["web"]
    assert WebPublic.model_fields["server_lookups"].exclude is True


@pytest.mark.parametrize(
    "address,identity",
    [
        ("192.0.2.1", "192.0.2.1"),
        ("2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"),
        ("2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"),
        ("2001:db8:1:3::1", "2001:db8:1:3::/64"),
        # IPv4 carried in IPv6 counts per IPv4 address, not as one shared /64.
        ("::ffff:192.0.2.1", "192.0.2.1"),
        ("anonymous", "anonymous"),
    ],
)
def test_quota_identity(address, identity):
    from hyperglass.api.quota import quota_identity

    assert quota_identity(address) == identity


@pytest.mark.parametrize(
    "first,second,shared",
    [
        ("2001:db8:1:2::1", "2001:db8:1:2:ffff::9", True),
        ("2001:db8:1:2::1", "2001:db8:1:3::1", False),
        ("198.51.100.1", "198.51.100.2", False),
    ],
)
def test_client_quota_is_per_ipv6_64_and_per_ipv4_address(lookups, first, second, shared):
    from hyperglass.api.routes import aspath_enrich

    configure(web={"aspath_enrichment": True, "client_ip": TRUSTED, "server_lookups": LOOKUPS})

    def post(address):
        return client.post(
            "/api/aspath/enrich",
            json={"as_path": [13335]},
            headers={"X-Forwarded-For": address},
        ).status_code

    with create_test_client([aspath_enrich], request_class=ProxyRequest) as client:
        # The configured per-client limit is 2 a minute.
        assert [post(first), post(first)] == [201, 201]
        assert post(second) == (429 if shared else 201)


def test_global_quota_is_configurable(lookups):
    from hyperglass.api.routes import aspath_enrich

    configure(web={"aspath_enrichment": True, "client_ip": TRUSTED, "server_lookups": LOOKUPS})
    with create_test_client([aspath_enrich], request_class=ProxyRequest) as client:
        statuses = [
            client.post(
                "/api/aspath/enrich",
                json={"as_path": [13335]},
                headers={"X-Forwarded-For": f"192.0.2.{index + 1}"},
            ).status_code
            for index in range(5)
        ]
    assert statuses == [201, 201, 201, 201, 429]


@pytest.mark.asyncio
async def test_dns_resolver_and_timeout_are_configurable(monkeypatch):
    from hyperglass.api import auxiliary

    configure(web={"server_lookups": LOOKUPS})
    real_client = httpx.AsyncClient
    requests = []
    options = []

    def factory(**kwargs):
        options.append(kwargs["timeout"])
        return real_client(
            transport=httpx.MockTransport(
                lambda request: requests.append(request)
                or httpx.Response(200, json={"Status": 0, "Answer": []})
            ),
            **kwargs,
        )

    monkeypatch.setattr(auxiliary.httpx, "AsyncClient", factory)
    await auxiliary._dns_query("example.com", "A")
    assert str(requests[0].url).startswith("https://doh.example.net/dns-query?")
    assert options == [3]


@pytest.mark.asyncio
async def test_concurrency_limit_is_configurable():
    from hyperglass.api import auxiliary

    configure(web={"server_lookups": LOOKUPS})
    slots = [auxiliary._outbound_slot() for _ in range(2)]
    try:
        for slot in slots:
            await slot.__aenter__()
        with pytest.raises(HTTPException, match="busy"):
            async with auxiliary._outbound_slot():
                pytest.fail("Over capacity")
    finally:
        for slot in slots:
            await slot.__aexit__(None, None, None)


@pytest.mark.asyncio
async def test_aspath_whois_server_is_configurable(monkeypatch):
    from hyperglass.api import auxiliary

    configure(structured={"ip_enrichment": {"whois_host": "whois.example.net", "whois_port": 4343}})
    reader = Mock(read=AsyncMock(side_effect=[b""]))
    writer = Mock(drain=AsyncMock())
    connect = AsyncMock(return_value=(reader, writer))
    monkeypatch.setattr(auxiliary.asyncio, "open_connection", connect)
    await auxiliary._asn_query(["13335"])
    connect.assert_awaited_once_with("whois.example.net", 4343)


@pytest.mark.asyncio
@pytest.mark.parametrize("bulk", [False, True], ids=["single", "bulk"])
async def test_enrichment_whois_server_and_timeouts_are_configurable(monkeypatch, bulk):
    from hyperglass.external import ip_enrichment

    configure(
        structured={
            "ip_enrichment": {
                "whois_host": "whois.example.net",
                "whois_port": 4343,
                "whois_timeout": 2.5,
                "whois_bulk_timeout": 7.5,
            }
        }
    )
    connection = Mock()
    connection.__enter__ = Mock(return_value=connection)
    connection.__exit__ = Mock(return_value=False)
    connection.recv.side_effect = [b""]
    create = Mock(return_value=connection)
    monkeypatch.setattr(ip_enrichment.socket, "create_connection", create)
    service = ip_enrichment.IPEnrichmentService()
    if bulk:
        await service._query_bgp_tools_bulk(["1.1.1.1"])
    else:
        await service._query_bgp_tools_for_ip("1.1.1.1")
    create.assert_called_once_with(("whois.example.net", 4343), timeout=7.5 if bulk else 2.5)
