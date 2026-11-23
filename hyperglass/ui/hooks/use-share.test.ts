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
