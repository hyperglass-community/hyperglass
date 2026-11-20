/**
 * Shared formatting for traceroute hop values.
 *
 * Both the on-screen traceroute table and the copy-to-clipboard text use these helpers, so the
 * copied output shows the same values as the table.
 */

/** Shown in place of a missing ASN, IP address or hostname. */
export const TRACEROUTE_BLANK = '—';

/** Shown in place of a missing round-trip time (a probe that timed out). */
export const TRACEROUTE_NO_RTT = '*';

/**
 * Determine if a hop value is missing. Parsers may emit the strings `'None'` or `'null'` for
 * missing values, so treat those as missing too.
 */
export function isBlankHopValue(value: string | null | undefined): value is null | undefined {
  return (
    value === null ||
    value === undefined ||
    value.trim() === '' ||
    value === 'None' ||
    value === 'null'
  );
}

/**
 * Format a hop's ASN for display, without an `AS` prefix. Exchange-point hops keep the literal
 * `IXP`. Returns `null` when the ASN is missing.
 */
export function formatHopASN(asn: string | null | undefined): string | null {
  if (isBlankHopValue(asn)) {
    return null;
  }
  return asn;
}

/**
 * Format a hop's IP address for display, preferring `display_ip` (truncated IPv6) over
 * `ip_address`. Returns `null` when neither is set.
 */
export function formatHopIP(hop: Pick<TracerouteHop, 'display_ip' | 'ip_address'>): string | null {
  if (!isBlankHopValue(hop.display_ip)) {
    return hop.display_ip;
  }
  if (!isBlankHopValue(hop.ip_address)) {
    return hop.ip_address;
  }
  return null;
}

/** Format a hop's hostname for display. Returns `null` when the hostname is missing. */
export function formatHopHostname(hostname: string | null | undefined): string | null {
  if (isBlankHopValue(hostname)) {
    return null;
  }
  return hostname;
}

/** Format a round-trip time in milliseconds. Returns `null` when the RTT is missing. */
export function formatHopRTT(rtt: number | null | undefined): string | null {
  if (rtt === null || rtt === undefined) {
    return null;
  }
  return `${rtt.toFixed(1)}ms`;
}
