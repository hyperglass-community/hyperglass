"""Bounded, best-effort PTR enrichment after a traceroute response is sent."""

import asyncio
import socket
from concurrent.futures import ThreadPoolExecutor
from ipaddress import ip_address
from threading import Lock, BoundedSemaphore

from hyperglass.state import use_state

# Cancelling an await does not stop libc DNS. Retain the slot until its actual
# worker finishes, so slow resolvers cannot grow the executor queue unboundedly.
# Created on first use, sized by `structured.ip_enrichment.reverse_dns.workers`; a
# configuration change takes effect on restart, like the rest of the configuration.
_executor = None
_slots = None
_pool_lock = Lock()


def _config():
    return use_state("params").structured.ip_enrichment.reverse_dns


def _pool():
    """Return the PTR executor and its slots, creating them on first use."""
    global _executor, _slots  # noqa: PLW0603
    with _pool_lock:
        if _executor is None or _slots is None:
            workers = _config().workers
            _executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="hyperglass-ptr")
            _slots = BoundedSemaphore(workers)
    return _executor, _slots


def _public_address(address):
    """Return a canonical public unicast address, or None for an internal hop."""
    try:
        parsed = ip_address(address)
    except ValueError:
        return None
    parsed = getattr(parsed, "ipv4_mapped", None) or parsed
    if not parsed.is_global or parsed.is_multicast or parsed.is_reserved:
        return None
    # Deprecated site-local space (fec0::/10) still reports as global.
    if getattr(parsed, "is_site_local", False):
        return None
    return str(parsed)


async def lookup_hostname(address: str):
    """Return a PTR hostname without blocking the event loop or queueing excess work."""
    address = _public_address(address)
    if address is None:
        return None
    executor, slots = _pool()
    if not slots.acquire(blocking=False):
        return None
    try:
        future = executor.submit(socket.gethostbyaddr, address)
    except Exception:
        slots.release()
        raise
    future.add_done_callback(lambda _: slots.release())
    try:
        result = await asyncio.wait_for(asyncio.wrap_future(future), _config().lookup_timeout)
    except (OSError, TimeoutError):
        return None
    hostname = result[0]
    if not hostname or len(hostname) > 253 or any(ord(char) < 33 for char in hostname):
        return None
    return hostname


def _missing_addresses(output):
    """Group missing hostnames by address up to the per-query budget."""
    max_addresses = _config().max_addresses
    pending = {}
    for hop in output.hops:
        if hop.hostname or not hop.ip_address:
            continue
        address = _public_address(hop.ip_address)
        if address is None:
            continue
        if address not in pending and len(pending) >= max_addresses:
            continue
        pending.setdefault(address, []).append(hop)
    return pending


async def enrich_hostnames(output) -> None:
    """Fill missing names within one shared deadline and a fixed address budget."""
    config = _config()
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
            asyncio.gather(*(worker() for _ in range(min(config.workers, len(pending))))),
            config.query_timeout,
        )
    except TimeoutError:
        # Partial results remain useful; a missing name is not a failed query.
        pass
