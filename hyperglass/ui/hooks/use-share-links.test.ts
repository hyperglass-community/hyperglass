import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testConfig } from '~/__tests__/render';
import {
  createShare,
  deleteShare,
  keepForLabel,
  shareFailureMessage,
  shareKey,
  shareLink,
  useShareLinks,
} from './use-share-links';

import type { CreatedShare, ShareFailure } from './use-share-links';

const QUERY_ID = `hyperglass.query.${'ab'.repeat(32)}`;
const SHARE_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'tok_3x4mpl3-d3l3t3-t0k3n-n3v3r-1n-4-url-xyz';
const DAY = 86400;

const created: CreatedShare = {
  id: SHARE_ID,
  expiresAt: '2026-12-23T08:00:00Z',
  deleteToken: TOKEN,
};

/** A `fetch` stub answering with `status` and `body` as JSON. */
function respond(status: number, body: unknown = {}) {
  const impl = vi.fn(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useShareLinks.setState({ links: {} });
});

describe('createShare', () => {
  it('posts the query id and the chosen time as JSON, and returns the share', async () => {
    const fetch = respond(201, created);
    const outcome = await createShare(QUERY_ID, 7 * DAY, 5000);

    expect(outcome).toEqual({ status: 'created', share: created });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/share');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ queryId: QUERY_ID, expiresIn: 7 * DAY });
    expect(init.cache).toBe('no-store');
  });

  it('takes an existing share (200) as created', async () => {
    respond(200, created);
    expect(await createShare(QUERY_ID, DAY, 5000)).toEqual({ status: 'created', share: created });
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
    const fetch = respond(status, { output: '<b>server text</b>', level: 'danger' });
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
    ['no id', { expiresAt: created.expiresAt, deleteToken: TOKEN }],
    ['an id that is not a share id', { ...created, id: '../../api/query' }],
    ['no token', { id: SHARE_ID, expiresAt: created.expiresAt }],
    ['an empty token', { ...created, deleteToken: '' }],
    ['an expiry that is not a time', { ...created, expiresAt: 'soon' }],
  ])('is an error for a response with %s', async (_, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 201 }),
      ),
    );
    expect(await createShare(QUERY_ID, DAY, 5000)).toEqual({ status: 'error' });
  });
});

describe('deleteShare', () => {
  it('sends the token in the X-Delete-Token header only', async () => {
    const fetch = respond(204);
    expect(await deleteShare(created, 5000)).toEqual({ status: 'deleted' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/share/${SHARE_ID}`);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('x-delete-token')).toBe(TOKEN);
    expect(init.body).toBeUndefined();
  });

  it.each<[number, string]>([
    [404, 'notFound'],
    [429, 'rateLimited'],
    [503, 'error'],
    [500, 'error'],
  ])('maps HTTP %i to %s', async (status, failure) => {
    respond(status);
    expect(await deleteShare(created, 5000)).toEqual({ status: failure });
  });

  it('sends nothing for an id that is not a share id', async () => {
    const fetch = respond(204);
    expect(await deleteShare({ ...created, id: '../query' }, 5000)).toEqual({
      status: 'notFound',
    });
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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a created link by result, and forgets it when set to null', () => {
    const key = shareKey(QUERY_ID, '2026-11-23 07:59:00');
    useShareLinks.getState().save(key, created);
    expect(useShareLinks.getState().links[key]).toEqual(created);

    useShareLinks.getState().save(key, null);
    expect(useShareLinks.getState().links).toEqual({});
  });

  it('keys a result by its query id and the time it ran, so a refreshed result is another', () => {
    expect(shareKey(QUERY_ID, '2026-11-23 07:59:00')).not.toBe(
      shareKey(QUERY_ID, '2026-11-23 08:05:00'),
    );
  });

  it('drops expired links whenever it saves', () => {
    const old = shareKey(QUERY_ID, '2026-11-01 00:00:00');
    useShareLinks.setState({
      links: { [old]: { ...created, expiresAt: '2026-11-23T07:59:59Z' } },
    });
    const key = shareKey(QUERY_ID, '2026-11-23 07:59:00');
    useShareLinks.getState().save(key, created);
    expect(Object.keys(useShareLinks.getState().links)).toEqual([key]);
  });

  it('is kept in memory only, never in web storage', () => {
    useShareLinks.getState().save(shareKey(QUERY_ID, 't'), created);
    const stored = [
      ...Object.keys(localStorage).map(k => localStorage.getItem(k)),
      ...Object.keys(sessionStorage).map(k => sessionStorage.getItem(k)),
    ].join('');
    expect(stored).not.toContain(TOKEN);
  });
});
