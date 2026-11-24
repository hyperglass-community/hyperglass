"""Headers set on an HTTP error reach the client through the app's handlers (#585)."""

# Standard Library
from unittest.mock import AsyncMock

# Third Party
import pytest
from litestar.testing import TestClient

# Project
from hyperglass.models.config.params import Params

# hyperglass.api reads state when it is imported, so import it inside the tests,
# after the autouse fixture in conftest.py has seeded the isolated store. The `state`
# and `client` fixtures are in this directory's conftest.py.


@pytest.fixture
def lookup_client(state, monkeypatch):
    """Build the app with both server lookups, which it adds only when configured at import."""
    # Project
    from hyperglass import api
    from hyperglass.api.routes import dns, aspath_enrich

    monkeypatch.setattr(api, "HANDLERS", [*api.HANDLERS, dns, aspath_enrich])
    with TestClient(app=api.create_app()) as test_client:
        yield test_client


def limit_lookups(state, monkeypatch) -> None:
    """Allow one server lookup per client, with both lookups enabled and answered."""
    # Project
    from hyperglass.api import routes

    monkeypatch.setattr(routes, "enrich_public_asns", AsyncMock(return_value={}))
    monkeypatch.setattr(routes, "resolve_public_dns", AsyncMock(return_value={}))
    state.cache.set(
        "params",
        Params(
            web={
                "aspath_enrichment": True,
                "dns_provider": {"name": "server"},
                "server_lookups": {
                    "dns": {"client_limit": 1},
                    "aspath": {"client_limit": 1},
                },
            },
        ),
    )


@pytest.mark.parametrize(
    "method,path,body",
    (
        pytest.param("POST", "/api/aspath/enrich", {"as_path": [13335]}, id="aspath"),
        pytest.param("GET", "/api/dns?name=example.com&type=AAAA", None, id="dns"),
    ),
)
def test_lookup_quota_sends_retry_after(lookup_client, state, monkeypatch, method, path, body):
    limit_lookups(state, monkeypatch)
    first = lookup_client.request(method, path, json=body)
    second = lookup_client.request(method, path, json=body)

    assert first.status_code < 400
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "60"
    assert second.json() == {
        "output": "Lookup rate limit exceeded",
        "level": "danger",
        "keywords": [],
    }


def test_method_not_allowed_sends_allow(client):
    response = client.get("/api/query")

    assert response.status_code == 405
    assert {method.strip() for method in response.headers["Allow"].split(",")} == {
        "POST",
        "OPTIONS",
    }
    assert response.json()["level"] == "danger"


def test_http_error_without_headers_sends_none(lookup_client, state, monkeypatch):
    # Third Party
    from litestar.exceptions import HTTPException

    # Project
    from hyperglass.api import routes

    async def unavailable(*args, **kwargs):
        raise HTTPException(status_code=503, detail="Lookup service unavailable")

    limit_lookups(state, monkeypatch)
    monkeypatch.setattr(routes, "enrich_public_asns", unavailable)
    response = lookup_client.post("/api/aspath/enrich", json={"as_path": [13335]})

    assert response.status_code == 503
    assert "retry-after" not in response.headers
    assert "allow" not in response.headers


def test_unexpected_error_headers_not_sent(client, monkeypatch):
    """Only HTTP errors carry headers meant for the client; a 500 sends none of its own."""
    # Project
    from hyperglass.api import routes

    class InternalError(Exception):
        headers = {"X-Internal-Host": "redis.internal:6379"}

    async def execute(*args, **kwargs):
        raise InternalError("redis.internal:6379")

    monkeypatch.setattr(routes, "_execute_query", execute)
    response = client.post(
        "/api/query",
        json={
            "queryLocation": "test",
            "queryType": "__hyperglass_frr_bgp_route__",
            "queryTarget": "2001:db8::/32",
        },
    )

    assert response.status_code == 500
    assert "x-internal-host" not in response.headers
    assert "redis.internal" not in response.text
