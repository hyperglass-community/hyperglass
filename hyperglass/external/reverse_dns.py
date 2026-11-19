"""Bounded, best-effort PTR enrichment after a traceroute response is sent."""

import asyncio
import socket
from concurrent.futures import ThreadPoolExecutor
from ipaddress import ip_address
from threading import BoundedSemaphore

PTR_WORKERS = 4
PTR_MAX_ADDRESSES = 32
PTR_LOOKUP_TIMEOUT = 1.0
PTR_QUERY_TIMEOUT = 2.0

# Cancelling an await does not stop libc DNS. Retain the slot until its actual
# worker finishes, so slow resolvers cannot grow the executor queue unboundedly.
_executor = ThreadPoolExecutor(max_workers=PTR_WORKERS, thread_name_prefix="hyperglass-ptr")
_slots = BoundedSemaphore(PTR_WORKERS)


def _public_address(address):
    """Return a canonical public unicast address, or None for an internal hop."""
    try:
        parsed = ip_address(address)
    except ValueError:
        return None
    parsed = getattr(parsed, "ipv4_mapped", None) or parsed
    if not parsed.is_global or parsed.is_multicast or parsed.is_reserved:
        return None
    return str(parsed)


async def lookup_hostname(address: str):
    """Return a PTR hostname without blocking the event loop or queueing excess work."""
    address = _public_address(address)
    if address is None:
        return None
    if not _slots.acquire(blocking=False):
        return None
    try:
        future = _executor.submit(socket.gethostbyaddr, address)
    except Exception:
        _slots.release()
        raise
    future.add_done_callback(lambda _: _slots.release())
    try:
        result = await asyncio.wait_for(asyncio.wrap_future(future), PTR_LOOKUP_TIMEOUT)
    except (OSError, TimeoutError):
        return None
    hostname = result[0]
    if not hostname or len(hostname) > 253 or any(ord(char) < 33 for char in hostname):
        return None
    return hostname


def _missing_addresses(output):
    """Group missing hostnames by address up to the per-query budget."""
    pending = {}
    for hop in output.hops:
        if hop.hostname or not hop.ip_address:
            continue
        address = _public_address(hop.ip_address)
        if address is None:
            continue
        if address not in pending and len(pending) >= PTR_MAX_ADDRESSES:
            continue
        pending.setdefault(address, []).append(hop)
    return pending


async def enrich_hostnames(output) -> None:
    """Fill missing names within one shared deadline and a fixed address budget."""
    pending = _missing_addresses(output)
    addresses = iter(pending)

    async def worker():
        for address in addresses:
            hostname = await lookup_hostname(address)
            if hostname:
                for hop in pending[address]:
                    if not hop.hostname:
                        hop.hostname = hostname

    try:
        await asyncio.wait_for(
            asyncio.gather(*(worker() for _ in range(min(PTR_WORKERS, len(pending))))),
            PTR_QUERY_TIMEOUT,
        )
    except TimeoutError:
        # Partial results remain useful; a missing name is not a failed query.
        pass
