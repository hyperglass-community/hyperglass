import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchShare,
  isShareId,
  isSnapshot,
  shareParam,
  shareQuery,
  useShareView,
  withoutShare,
} from './use-share';

import type { Snapshot } from './use-share';

const ID = '0123456789abcdef0123456789abcdef';

/** A snapshot as `GET /api/share/{id}` returns it (S1, #559). */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: ID,
    version: 1,
    createdAt: '2026-11-20T08:05:00Z',
    expiresAt: '2026-12-20T08:05:00Z',
    results: [
      {
        query: {
          location: 'router_one',
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTypeName: 'BGP Route',
          target: '2001:db8::/32',
          variables: {},
        },
        labels: { location: 'Router One', queryType: 'BGP Route' },
        output: 'some output',
        format: 'text/plain',
        timestamp: '2026-11-20 08:00:00',
        runtime: 2,
      },
    ],
    ...overrides,
  };
}

describe('shareParam', () => {
  it.each([
    ['', null],
    ['?location=router_one', null],
    [`?share=${ID}`, ID],
    [`?location=router_one&share=${ID}&target=192.0.2.1`, ID],
    ['?share=', ''],
    ['?share', ''],
    [`?share=${ID}&share=ffffffffffffffffffffffffffffffff`, ID],
  ])('reads %j as %j', (search, expected) => {
    expect(shareParam(search)).toBe(expected);
  });
});

describe('isShareId', () => {
  it('takes 32 lowercase hex characters', () => {
    expect(isShareId(ID)).toBe(true);
  });

  it.each([
    '',
    ID.slice(1),
    `${ID}0`,
    ID.toUpperCase(),
    `${ID.slice(1)}g`,
    '../api/query/../../../aaaaaaaaaa',
    `${ID}/../../api/query`,
    `${ID.slice(2)}%2f`,
    'index',
  ])('refuses %j', value => {
    expect(isShareId(value)).toBe(false);
  });
});

describe('withoutShare', () => {
  it.each([
    ['', ''],
    [`?share=${ID}`, ''],
    [`?share=${ID}&utm=1`, '?utm=1'],
    [`?utm=1&share=${ID}&share=2`, '?utm=1'],
    ['?utm=1', '?utm=1'],
  ])('removes the share parameter from %j', (search, expected) => {
    expect(withoutShare(search)).toBe(expected);
  });
});

describe('isSnapshot', () => {
  it('accepts text and structured snapshots', () => {
    expect(isSnapshot(snapshot())).toBe(true);
    const [result] = snapshot().results;
    const structured = snapshot({
      results: [
        {
          ...result,
          format: 'application/json',
          output: { vrf: 'default', count: 0, routes: [], winning_weight: 'high' },
        },
      ],
    });
    expect(isSnapshot(structured)).toBe(true);
    expect(
      isSnapshot(
        snapshot({
          results: [
            { ...result, format: 'application/json', output: { hops: [{ hop_number: 1 }] } },
          ],
        } as never),
      ),
    ).toBe(true);
    expect(
      isSnapshot(
        snapshot({
          results: [
            { ...result, query: { ...result.query, target: ['192.0.2.1', '2001:db8::1'] } },
          ],
        }),
      ),
    ).toBe(true);
  });

  const [result] = snapshot().results;
  it.each([
    ['not an object', 'text'],
    ['no results', { ...snapshot(), results: [] }],
    ['results not a list', { ...snapshot(), results: {} }],
    ['no expiry', { ...snapshot(), expiresAt: undefined }],
    ['a numeric creation time', { ...snapshot(), createdAt: 1 }],
    ['a version that is not a number', { ...snapshot(), version: '1' }],
    ['text output that is not a string', { ...snapshot(), results: [{ ...result, output: 42 }] }],
    [
      'structured output as text',
      { ...snapshot(), results: [{ ...result, format: 'application/json' }] },
    ],
    [
      'structured output without routes or hops',
      { ...snapshot(), results: [{ ...result, format: 'application/json', output: {} }] },
    ],
    ['an unknown format', { ...snapshot(), results: [{ ...result, format: 'text/html' }] }],
    ['no labels', { ...snapshot(), results: [{ ...result, labels: undefined }] }],
    [
      'a variable that is not a string',
      { ...snapshot(), results: [{ ...result, query: { ...result.query, variables: { a: 1 } } }] },
    ],
    [
      'a target that is not a string',
      { ...snapshot(), results: [{ ...result, query: { ...result.query, target: 1 } }] },
    ],
    ['a runtime that is not a number', { ...snapshot(), results: [{ ...result, runtime: '2' }] }],
  ])('refuses %s', (_, value) => {
    expect(isSnapshot(value)).toBe(false);
  });
});

describe('isSnapshot with structured output', () => {
  const [base] = snapshot().results;

  const route = {
    prefix: '2001:db8::/32',
    active: true,
    age: 60,
    weight: 0,
    med: 0,
    local_preference: 100,
    as_path: [65000, 64999],
    communities: ['65000:1'],
    next_hop: '2001:db8::1',
    source_as: 64999,
    source_rid: '192.0.2.10',
    peer_rid: '192.0.2.11',
    rpki_state: 1,
    filtered: false,
    next_hop_asn: null,
  };

  const hop = {
    hop_number: 1,
    ip_address: '2001:db8::5',
    display_ip: null,
    hostname: 'r1.example.net',
    rtt1: 1.1,
    rtt2: null,
    rtt3: 1.3,
    loss_pct: 0,
    sent_count: 3,
    last_rtt: 1.3,
    avg_rtt: 1.2,
    best_rtt: 1.1,
    worst_rtt: 1.3,
    asn: '65000',
    org: null,
    prefix: null,
    country: null,
    rir: null,
    allocated: null,
  };

  function bgp(output: Record<string, unknown>): unknown {
    return {
      ...snapshot(),
      results: [
        {
          ...base,
          format: 'application/json',
          output: { vrf: 'default', count: 1, winning_weight: 'high', routes: [route], ...output },
        },
      ],
    };
  }

  function trace(output: Record<string, unknown>): unknown {
    return {
      ...snapshot(),
      results: [{ ...base, format: 'application/json', output: { hops: [hop], ...output } }],
    };
  }

  it('accepts complete routes and hops, with AS names', () => {
    expect(isSnapshot(bgp({ asn_organizations: { '64999': { name: 'Example' } } }))).toBe(true);
    expect(isSnapshot(trace({}))).toBe(true);
  });

  // Each of these crashed the whole page when it reached the tables (#560 review).
  it.each([
    ['an empty route', bgp({ routes: [{}] })],
    ['a route without communities', bgp({ routes: [{ ...route, communities: undefined }] })],
    ['an object in the communities', bgp({ routes: [{ ...route, communities: [{}] }] })],
    ['an object in the AS path', bgp({ routes: [{ ...route, as_path: [{}] }] })],
    ['an AS path that is not a list', bgp({ routes: [{ ...route, as_path: '65000' }] })],
    ['an object as the prefix', bgp({ routes: [{ ...route, prefix: {} }] })],
    ['an age that is not a number', bgp({ routes: [{ ...route, age: '60' }] })],
    ['an unknown RPKI state', bgp({ routes: [{ ...route, rpki_state: 7 }] })],
    ['an object as the next hop AS', bgp({ routes: [{ ...route, next_hop_asn: {} }] })],
    ['an unknown winning weight', bgp({ winning_weight: 'middle' })],
    ['AS names that are not objects', bgp({ asn_organizations: { '64999': 'Example' } })],
    ['an AS name that is not text', bgp({ asn_organizations: { '64999': { name: {} } } })],
    ['an empty hop', trace({ hops: [{}] })],
    ['a hop number that is not a number', trace({ hops: [{ ...hop, hop_number: '1' }] })],
    ['an object as a hostname', trace({ hops: [{ ...hop, hostname: {} }] })],
    ['a latency that is not a number', trace({ hops: [{ ...hop, avg_rtt: '1' }] })],
    ['a list as the AS', trace({ hops: [{ ...hop, asn: ['65000'] }] })],
    ['a string in the AS path', bgp({ routes: [{ ...route, as_path: ['65000'] }] })],
    ['a fraction in the AS path', bgp({ routes: [{ ...route, as_path: [65000.5] }] })],
    ['a string as the origin AS', bgp({ routes: [{ ...route, source_as: '64999' }] })],
    ['an AS name under a key that is not an ASN', bgp({ asn_organizations: { x: { name: 'X' } } })],
  ])('refuses %s', (_, value) => {
    expect(isSnapshot(value)).toBe(false);
  });

  // Names an object already has: looked up as an ASN they reach Object's own members, and
  // crashed the page past the error boundary (#560 re-review).
  it.each(['__proto__', 'constructor', 'toString'])('refuses %j as an ASN', name => {
    expect(isSnapshot(bgp({ routes: [{ ...route, as_path: [name, 64999] }] }))).toBe(false);
    expect(isSnapshot(bgp({ routes: [{ ...route, next_hop_asn: name }] }))).toBe(false);
    expect(isSnapshot(trace({ hops: [{ ...hop, asn: name }] }))).toBe(false);
    expect(isSnapshot(bgp({ asn_organizations: JSON.parse(`{"${name}": {"name": "X"}}`) }))).toBe(
      false,
    );
  });

  it('accepts the next hop AS as the server writes it', () => {
    expect(isSnapshot(bgp({ routes: [{ ...route, next_hop_asn: 'AS13335' }] }))).toBe(true);
    // A next hop on an exchange's peering LAN: the enrichment's ASN is `IXP`.
    expect(isSnapshot(bgp({ routes: [{ ...route, next_hop_asn: 'ASIXP' }] }))).toBe(true);
  });

  it.each(['AS__proto__', 'ASconstructor', 'AStoString', 'AS', 'IXP', 'AS13335x'])(
    'refuses %j as the next hop AS',
    value => {
      expect(isSnapshot(bgp({ routes: [{ ...route, next_hop_asn: value }] }))).toBe(false);
    },
  );

  it.each([
    ['an ASN', '65000'],
    ['an exchange point', 'IXP'],
    ['no ASN, as the server writes it', 'None'],
    ['no ASN', null],
  ])('accepts a hop with %s', (_, asn) => {
    expect(isSnapshot(trace({ hops: [{ ...hop, asn }] }))).toBe(true);
  });
});

describe('shareQuery', () => {
  it('gives the shared query in the form history reuse takes', () => {
    expect(shareQuery(snapshot())).toEqual({
      query: {
        queryLocation: ['router_one'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTypeName: 'BGP Route',
        queryTarget: ['2001:db8::/32'],
        queryVariables: {},
      },
      locations: ['Router One'],
    });
  });

  it('keeps a list of targets and the variables', () => {
    const [result] = snapshot().results;
    const value = snapshot({
      results: [
        {
          ...result,
          query: { ...result.query, target: ['192.0.2.1', '2001:db8::1'], variables: { vrf: 'b' } },
        },
      ],
    });
    expect(shareQuery(value).query).toMatchObject({
      queryTarget: ['192.0.2.1', '2001:db8::1'],
      queryVariables: { vrf: 'b' },
    });
  });
});

describe('fetchShare', () => {
  let fetch: ReturnType<typeof vi.fn>;

  function answer(status: number, body: unknown = {}): void {
    fetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      json: async () => body,
    });
  }

  beforeEach(() => {
    fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets the snapshot with one GET to its address', async () => {
    answer(200, snapshot());
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'found', snapshot: snapshot() });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/share/${ID}`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not follow a redirect, so one request is all it makes', async () => {
    answer(200, snapshot());
    await fetchShare(ID, 1000);
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });

  it('is an error when the server redirects', async () => {
    // With `redirect: 'error'`, `fetch` rejects a redirect with a TypeError.
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'error' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [404, 'notFound'],
    [422, 'unsupported'],
    [429, 'rateLimited'],
    [500, 'error'],
    [503, 'error'],
    [400, 'error'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    answer(status, { output: '<b>server text</b>', level: 'danger' });
    expect(await fetchShare(ID, 1000)).toEqual({ status: expected });
  });

  it('is an error when the request fails', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'error' });
  });

  it('is an error when the response is not JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'error' });
  });

  it('is an error when the response is not a snapshot it can show', async () => {
    answer(200, { ...snapshot(), results: [] });
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'error' });
  });

  it('is an error when the response is for another share', async () => {
    answer(200, snapshot({ id: 'ffffffffffffffffffffffffffffffff' }));
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'error' });
  });

  it('is unsupported when a 200 response has another version', async () => {
    answer(200, snapshot({ version: 2 }));
    expect(await fetchShare(ID, 1000)).toEqual({ status: 'unsupported' });
  });

  it('never requests an id that is not one', async () => {
    expect(await fetchShare('../query', 1000)).toEqual({ status: 'notFound' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('useShareView', () => {
  afterEach(() => {
    useShareView.setState({ id: null });
  });

  it('opens and closes a share', () => {
    useShareView.getState().open(ID);
    expect(useShareView.getState().id).toBe(ID);
    useShareView.getState().close();
    expect(useShareView.getState().id).toBeNull();
  });
});
