import { ChakraProvider } from '@chakra-ui/react';
import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ASNField, HostnameField, LatencyField } from '~/components/output/traceroute-fields';
import { useTableToString } from './use-table-to-string';

vi.mock('~/context', () => ({
  useConfig: () => ({
    web: { text: {} },
    parsedDataFields: [],
    messages: { noOutput: 'No output' },
  }),
}));

const blankHop: TracerouteHop = {
  hop_number: 1,
  ip_address: null,
  display_ip: null,
  hostname: null,
  rtt1: null,
  rtt2: null,
  rtt3: null,
  loss_pct: 100,
  sent_count: 3,
  last_rtt: null,
  avg_rtt: null,
  best_rtt: null,
  worst_rtt: null,
  asn: null,
  org: null,
  prefix: null,
  country: null,
  rir: null,
  allocated: null,
};

const hops: TracerouteHop[] = [
  // Normal hop.
  {
    ...blankHop,
    hop_number: 1,
    ip_address: '2001:db8::1',
    hostname: 'core1.example.net',
    loss_pct: 0,
    last_rtt: 1.04,
    avg_rtt: 1.26,
    best_rtt: 0.98,
    worst_rtt: 2.5,
    asn: '64496',
    org: 'Example Networks',
  },
  // Exchange-point hop.
  {
    ...blankHop,
    hop_number: 2,
    ip_address: '192.0.2.10',
    hostname: 'None',
    loss_pct: 0,
    last_rtt: 3,
    avg_rtt: 3,
    best_rtt: 3,
    worst_rtt: 3,
    asn: 'IXP',
    org: 'Example IX',
  },
  // Hop with parser placeholders for missing values.
  { ...blankHop, hop_number: 3, ip_address: 'None', hostname: 'null', asn: 'None' },
  // Hop with nothing at all.
  { ...blankHop, hop_number: 4 },
];

const response = {
  output: { target: '2001:db8::ffff', source: 'router1', hops, max_hops: 30, packet_size: 60 },
  timestamp: '2026-01-01 00:00:00',
} as unknown as QueryResponse;

function copiedRows(): string[][] {
  const { result } = renderHook(() => useTableToString(['2001:db8::ffff'], response));
  const lines = result.current().split('\n');
  const start = lines.findIndex(line => line.startsWith('Hop')) + 2;
  return lines.slice(start).map(line => line.trim().split(/\s{2,}/));
}

function shownText(element: JSX.Element): string {
  const { container, unmount } = render(<ChakraProvider>{element}</ChakraProvider>);
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('useTableToString traceroute', () => {
  it('copies exchange-point and blank ASNs without an AS prefix', () => {
    const asns = copiedRows().map(row => row[3]);
    expect(asns).toEqual(['64496', 'IXP', '—', '—']);
    expect(asns.join(' ')).not.toMatch(/AS/);
  });

  it('copies blank IP addresses and hostnames the way the table shows them', () => {
    const rows = copiedRows();
    expect(rows.map(row => row[1])).toEqual(['2001:db8::1', '192.0.2.10', '—', '—']);
    expect(rows.map(row => row[2])).toEqual(['core1.example.net', '—', '—', '—']);
  });

  it('matches the table cells for every hop', () => {
    const rows = copiedRows();
    hops.forEach((hop, i) => {
      const [, , hostname, asn, , , last, avg, best, worst] = rows[i];
      expect(asn).toBe(shownText(<ASNField asn={hop.asn} org={hop.org} />));
      expect(hostname).toBe(shownText(<HostnameField hostname={hop.hostname} />));
      expect([last, avg, best, worst]).toEqual(
        [hop.last_rtt, hop.avg_rtt, hop.best_rtt, hop.worst_rtt].map(rtt =>
          shownText(<LatencyField rtt={rtt} />),
        ),
      );
    });
  });
});
