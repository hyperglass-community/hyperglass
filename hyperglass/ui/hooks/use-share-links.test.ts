import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testConfig } from '~/__tests__/render';
import {
  createShare,
  deleteShare,
  keepForLabel,
  shareFailureMessage,
  shareLink,
  useShareLinks,
} from './use-share-links';

import type { ShareFailure, ShareLink } from './use-share-links';

const QUERY_ID = `hyperglass.query.${'ab'.repeat(32)}`;
const OTHER_QUERY = `hyperglass.query.${'cd'.repeat(32)}`;
const SHARE_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'tok_3x4mpl3-d3l3t3-t0k3n-n3v3r-1n-4-url-xyz';
const DAY = 86400;
/** This browser's clock in these tests. */
const NOW = Date.parse('2026-11-23T08:00:00Z');

const body = { id: SHARE_ID, expiresAt: '2026-12-23T08:00:00Z', deleteToken: TOKEN };

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A `fetch` stub giving the answers in turn, the last one again once they run out. */
function respond(...answers: Answer[]) {
  let call = 0;
  const impl = vi.fn(async (_url: string, _init?: RequestInit) => {
    const { status, body: json = {}, headers = {} } = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return new Response(status === 204 ? null : JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useShareLinks.setState({ links: {} });
});

describe('createShare', () => {
  it('posts the query id and the chosen time as JSON, and returns the share', async () => {
    const fetch = respond({ status: 201, body });
    const outcome = await createShare(QUERY_ID, 30 * DAY, 5000);

    expect(outcome).toEqual({
      status: 'created',
      share: { ...body, deadline: NOW + 30 * DAY * 1000 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/share');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ queryId: QUERY_ID, expiresIn: 30 * DAY });
    expect(init.cache).toBe('no-store');
  });

  it('takes an existing share (200) as created', async () => {
    respond({ status: 200, body });
    expect(await createShare(QUERY_ID, 30 * DAY, 5000)).toMatchObject({
      status: 'created',
      share: body,
    });
  });

  it("counts the link's lifetime from the server's clock (Date), not this browser's", async () => {
    // This browser is a year ahead: by its clock the link expired long ago.
    vi.setSystemTime(Date.parse('2027-11-23T08:00:00Z'));
    respond({ status: 201, body, headers: { date: 'Mon, 23 Nov 2026 08:00:00 GMT' } });
    const outcome = await createShare(QUERY_ID, 7 * DAY, 5000);
    expect(outcome).toEqual({
      status: 'created',
      share: { ...body, deadline: Date.parse('2027-11-23T08:00:00Z') + 30 * DAY * 1000 },
    });
  });

  it('keeps the expiry the server gives a reused share, when it sends Date', async () => {
    // Shared again: the server keeps the first expiry, 10 days from its now.
    respond({
      status: 200,
      body: { ...body, expiresAt: '2026-12-03T08:00:00Z' },
      headers: { date: 'Mon, 23 Nov 2026 08:00:00 GMT' },
    });
    const outcome = await createShare(QUERY_ID, 90 * DAY, 5000);
    expect(outcome).toMatchObject({ share: { deadline: NOW + 10 * DAY * 1000 } });
  });

  it('counts the requested time from the request without a Date header', async () => {
    vi.setSystemTime(Date.parse('2027-11-23T08:00:00Z'));
    respond({ status: 201, body });
    expect(await createShare(QUERY_ID, 7 * DAY, 5000)).toMatchObject({
      share: { deadline: Date.parse('2027-11-23T08:00:00Z') + 7 * DAY * 1000 },
    });
  });

  it.each<[number, ShareFailure]>([
    [404, 'resultExpired'],
    [409, 'pending'],
    [403, 'notAllowed'],
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [400, 'invalidExpiry'],
    [503, 'unavailable'],
    [500, 'error'],
    [415, 'error'],
  ])('maps HTTP %i to %s, without reading the body', async (status, failure) => {
    const fetch = respond({ status, body: { output: '<b>server text</b>', level: 'danger' } });
    expect(await createShare(QUERY_ID, DAY, 5000)).toEqual({ status: failure });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('is an error when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await createShare(QUERY_ID, DAY, 5000)).toEqual({ status: 'error' });
  });

  it.each([
    ['not JSON', 'nope'],
    ['no id', { expiresAt: body.expiresAt, deleteToken: TOKEN }],
    ['an id that is not a share id', { ...body, id: '../../api/query' }],
    ['no token', { id: SHARE_ID, expiresAt: body.expiresAt }],
    ['an empty token', { ...body, deleteToken: '' }],
    ['a token longer than the server accepts', { ...body, deleteToken: 'x'.repeat(129) }],
    ['an expiry that is not a time', { ...body, expiresAt: 'soon' }],
  ])('is an error for a response with %s', async (_, json) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(typeof json === 'string' ? json : JSON.stringify(json), { status: 201 }),
      ),
    );
    expect(await createShare(QUERY_ID, DAY, 5000)).toEqual({ status: 'error' });
  });

  it('takes a token of the longest length the server accepts', async () => {
    respond({ status: 201, body: { ...body, deleteToken: 'x'.repeat(128) } });
    expect(await createShare(QUERY_ID, DAY, 5000)).toMatchObject({ status: 'created' });
  });
});

describe('deleteShare', () => {
  const link = { id: SHARE_ID, deleteToken: TOKEN };

  it('sends the token in the X-Delete-Token header only', async () => {
    const fetch = respond({ status: 204 });
    expect(await deleteShare(link, 5000)).toEqual({ status: 'deleted' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/share/${SHARE_ID}`);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('x-delete-token')).toBe(TOKEN);
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe('no-store');
  });

  it.each<[number, string]>([
    [429, 'rateLimited'],
    [503, 'error'],
    [500, 'error'],
  ])('maps HTTP %i to %s', async (status, failure) => {
    const fetch = respond({ status });
    expect(await deleteShare(link, 5000)).toEqual({ status: failure });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each<[number, string]>([
    [404, 'notFound'],
    [200, 'rotated'],
    [422, 'rotated'],
    [429, 'rateLimited'],
    [500, 'error'],
  ])(
    'after a 404, reads the share once without the token: HTTP %i is %s',
    async (status, outcome) => {
      const fetch = respond({ status: 404 }, { status });
      expect(await deleteShare(link, 5000)).toEqual({ status: outcome });

      expect(fetch).toHaveBeenCalledTimes(2);
      const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
      expect(url).toBe(`/api/share/${SHARE_ID}`);
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).has('x-delete-token')).toBe(false);
      expect(JSON.stringify(init)).not.toContain(TOKEN);
      expect(init.cache).toBe('no-store');
      expect(init.redirect).toBe('error');
    },
  );

  it('sends nothing for an id that is not a share id', async () => {
    const fetch = respond({ status: 204 });
    expect(await deleteShare({ ...link, id: '../query' }, 5000)).toEqual({ status: 'notFound' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('shareLink', () => {
  it('is the page origin and path with only the share parameter', () => {
    expect(shareLink(SHARE_ID, { origin: 'https://lg.example.net', pathname: '/' })).toBe(
      `https://lg.example.net/?share=${SHARE_ID}`,
    );
  });

  it('keeps a sub-path and a port, on an IPv6-literal origin', () => {
    expect(
      shareLink(SHARE_ID, { origin: 'http://[2001:db8::1]:8443', pathname: '/tools/lg/' }),
    ).toBe(`http://[2001:db8::1]:8443/tools/lg/?share=${SHARE_ID}`);
  });
});

describe('keepForLabel', () => {
  const text = testConfig.web.text;
  it.each([
    [60, '1 minute'],
    [90, '1.5 minutes'],
    [600, '10 minutes'],
    [3600, '1 hour'],
    [5400, '90 minutes'],
    [12 * 3600, '12 hours'],
    [DAY, '1 day'],
    [7 * DAY, '7 days'],
    [36 * 3600, '36 hours'],
    [365 * DAY, '365 days'],
  ])('labels %i seconds "%s"', (seconds, label) => {
    expect(keepForLabel(seconds, text)).toBe(label);
  });

  it('uses the configured text', () => {
    expect(keepForLabel(7 * DAY, { ...text, shareDays: '{count} jours' })).toBe('7 jours');
  });
});

describe('shareFailureMessage', () => {
  const { messages } = testConfig;
  it.each<[ShareFailure, string]>([
    ['resultExpired', messages.shareResultExpired],
    ['pending', messages.sharePending],
    ['notAllowed', messages.shareNotAllowed],
    ['tooLarge', messages.shareTooLarge],
    ['invalidExpiry', messages.shareInvalidExpiry],
    ['rateLimited', messages.rateLimited],
    ['unavailable', messages.shareUnavailable],
    ['notFound', messages.shareNotFound],
    ['error', messages.general],
  ])('%s shows its configured message', (failure, message) => {
    expect(message).toBeTruthy();
    expect(shareFailureMessage(failure, messages)).toBe(message);
  });
});

describe('useShareLinks', () => {
  const link = (overrides: Partial<ShareLink> = {}): ShareLink => ({
    ...body,
    deadline: NOW + DAY * 1000,
    timestamp: '2026-11-23 07:59:00',
    ...overrides,
  });

  it('keeps every link created for a query, across its results, until removed', () => {
    const { add, remove } = useShareLinks.getState();
    add(QUERY_ID, link());
    // The query run again (a forced refresh): a later result, another link.
    add(QUERY_ID, link({ id: 'f'.repeat(32), timestamp: '2026-11-23 08:05:00' }));
    expect(useShareLinks.getState().links[QUERY_ID].map(l => l.id)).toEqual([
      SHARE_ID,
      'f'.repeat(32),
    ]);

    remove(QUERY_ID, SHARE_ID);
    expect(useShareLinks.getState().links[QUERY_ID].map(l => l.id)).toEqual(['f'.repeat(32)]);
    remove(QUERY_ID, 'f'.repeat(32));
    expect(useShareLinks.getState().links).toEqual({});
  });

  it('replaces a link with the same id, as when its token can no longer delete it', () => {
    const { add } = useShareLinks.getState();
    add(QUERY_ID, link());
    add(QUERY_ID, link({ deleteToken: null }));
    expect(useShareLinks.getState().links[QUERY_ID]).toEqual([link({ deleteToken: null })]);
  });

  it('drops expired links, by their deadline, whenever it changes', () => {
    useShareLinks.setState({
      links: { [OTHER_QUERY]: [link({ deadline: NOW - 1 })] },
    });
    useShareLinks.getState().add(QUERY_ID, link());
    expect(Object.keys(useShareLinks.getState().links)).toEqual([QUERY_ID]);
  });

  it('is kept in memory only, never in web storage', () => {
    useShareLinks.getState().add(QUERY_ID, link());
    const stored = [
      ...Object.keys(localStorage).map(k => localStorage.getItem(k)),
      ...Object.keys(sessionStorage).map(k => sessionStorage.getItem(k)),
    ].join('');
    expect(stored).not.toContain(TOKEN);
  });
});
