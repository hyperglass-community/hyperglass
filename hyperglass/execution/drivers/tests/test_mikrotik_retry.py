"""A completed BGP query never starts another SSH session."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from hyperglass.execution.drivers.ssh_netmiko import delay_factor_override
from hyperglass.exceptions.public import DeviceTimeout
from hyperglass.models.data.bgp_route import BGPRouteTable
from netmiko.exceptions import ReadTimeout


@pytest.fixture(autouse=True)
def request_budget(monkeypatch):
    from hyperglass.api import routes

    params = SimpleNamespace(request_timeout=10)
    monkeypatch.setattr(routes, "use_state", lambda _: params)
    return params


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


@pytest.mark.asyncio
async def test_late_read_fault_does_not_start_another_session(monkeypatch, request_budget):
    from hyperglass.api import routes

    request_budget.request_timeout = 2.05
    query = mikrotik_query()
    fault = read_fault(query)

    async def late_fault(data):
        await asyncio.sleep(0.1)
        raise fault

    execute = AsyncMock(side_effect=late_fault)
    monkeypatch.setattr(routes, "execute", execute)
    with pytest.raises(DeviceTimeout) as caught:
        await routes._execute_query(query)
    assert caught.value is fault
    execute.assert_awaited_once()
    assert delay_factor_override.get() is None


@pytest.mark.asyncio
async def test_retry_is_cancelled_at_shared_deadline(monkeypatch, request_budget):
    from hyperglass.api import routes

    request_budget.request_timeout = 2.1
    calls = []
    cancelled = asyncio.Event()

    async def execute(data):
        calls.append(asyncio.get_running_loop().time())
        if len(calls) == 1:
            await asyncio.sleep(0.03)
            raise read_fault(data)
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(routes, "execute", execute)
    started = asyncio.get_running_loop().time()
    async with asyncio.timeout(3):
        with pytest.raises(DeviceTimeout) as caught:
            await routes._execute_query(mikrotik_query())
    assert isinstance(caught.value.__cause__, TimeoutError)
    assert len(calls) == 2
    assert cancelled.is_set()
    assert asyncio.get_running_loop().time() - started < request_budget.request_timeout
    assert delay_factor_override.get() is None


@pytest.mark.asyncio
async def test_driver_timeout_keeps_its_type(monkeypatch):
    from hyperglass.api import routes

    monkeypatch.setattr(routes, "execute", AsyncMock(side_effect=TimeoutError("driver error")))
    with pytest.raises(TimeoutError, match="driver error"):
        await routes._execute_query(mikrotik_query())
