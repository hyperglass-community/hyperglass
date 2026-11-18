"""A completed BGP query never starts another SSH session."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from hyperglass.execution.drivers.ssh_netmiko import delay_factor_override
from hyperglass.exceptions.public import DeviceTimeout
from hyperglass.models.data.bgp_route import BGPRouteTable
from netmiko.exceptions import ReadTimeout


@pytest.mark.parametrize("platform", ["mikrotik_routeros", "frr"])
@pytest.mark.parametrize("output", ["empty", "routes"])
@pytest.mark.asyncio
async def test_completed_queries_run_once(monkeypatch, platform, output):
    from hyperglass.api import routes

    query = SimpleNamespace(device=SimpleNamespace(platform=platform))
    execute = AsyncMock(return_value=output)
    monkeypatch.setattr(routes, "execute", execute)
    assert await routes._execute_query(query) == output
    execute.assert_awaited_once_with(query)
    assert delay_factor_override.get() is None


@pytest.mark.asyncio
async def test_failed_query_preserves_the_error(monkeypatch):
    from hyperglass.api import routes

    execute = AsyncMock(side_effect=RuntimeError("connection failed"))
    monkeypatch.setattr(routes, "execute", execute)
    with pytest.raises(RuntimeError, match="connection failed"):
        await routes._execute_query(SimpleNamespace())
    execute.assert_awaited_once()


def mikrotik_query(**overrides):
    return SimpleNamespace(
        device=SimpleNamespace(
            platform=overrides.get("platform", "mikrotik_routeros"),
            name="router", proxy=None,
            driver_config={"global_delay_factor": overrides.get("factor", 1)},
        ),
        directive=SimpleNamespace(
            _hyperglass_builtin=overrides.get("builtin", True),
            query_kind=overrides.get("kind", "bgp_route"),
        ),
    )


def read_fault(query, cause=None):
    cause = cause if cause is not None else ReadTimeout("Prompt missing; incomplete reply")
    error = DeviceTimeout(error=cause, device=query.device)
    error.__cause__ = cause
    return error


@pytest.mark.asyncio
@pytest.mark.parametrize("factor,expected", [(1, 3), (6, 12)])
async def test_one_read_fault_retries_with_higher_factor(monkeypatch, factor, expected):
    from hyperglass.api import routes

    query = mikrotik_query(factor=factor)
    factors = []

    async def execute(data):
        factors.append(delay_factor_override.get())
        if len(factors) == 1:
            raise read_fault(data)
        return "complete reply"

    monkeypatch.setattr(routes, "execute", execute)
    assert await routes._execute_query(query) == "complete reply"
    assert factors == [None, expected]
    assert delay_factor_override.get() is None


@pytest.mark.asyncio
async def test_complete_zero_route_table_does_not_retry(monkeypatch):
    from hyperglass.api import routes

    output = BGPRouteTable(routes=[], count=0, vrf="default", winning_weight="high")
    execute = AsyncMock(return_value=output)
    monkeypatch.setattr(routes, "execute", execute)
    assert await routes._execute_query(mikrotik_query()) is output
    execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_second_read_fault_propagates_and_resets_context(monkeypatch):
    from hyperglass.api import routes

    query = mikrotik_query()
    error = read_fault(query)
    execute = AsyncMock(side_effect=error)
    monkeypatch.setattr(routes, "execute", execute)
    with pytest.raises(DeviceTimeout) as caught:
        await routes._execute_query(query)
    assert caught.value is error
    assert execute.await_count == 2
    assert delay_factor_override.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("options", [{"platform": "frr"}, {"builtin": False}, {"kind": "ping"}])
async def test_only_builtin_mikrotik_bgp_reads_retry(monkeypatch, options):
    from hyperglass.api import routes

    query = mikrotik_query(**options)
    execute = AsyncMock(side_effect=read_fault(query))
    monkeypatch.setattr(routes, "execute", execute)
    with pytest.raises(DeviceTimeout):
        await routes._execute_query(query)
    execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_request_deadline_is_not_a_read_retry(monkeypatch):
    from hyperglass.api import routes

    query = mikrotik_query()
    execute = AsyncMock(side_effect=read_fault(query, TimeoutError("request deadline")))
    monkeypatch.setattr(routes, "execute", execute)
    with pytest.raises(DeviceTimeout):
        await routes._execute_query(query)
    execute.assert_awaited_once()
