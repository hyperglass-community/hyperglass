import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import {
  all,
  andJoin,
  chunkArray,
  dedupObjectArray,
  entries,
  fetchWithTimeout,
  formatText,
  isFQDN,
  randomId,
} from './common';

test('all - all items are truthy', () => {
  // biome-ignore lint/suspicious/noSelfCompare: because this is a test, duh
  expect(all(1 === 1, true, 'one' === 'one')).toBe(true);
});

test('all - one item is not truthy', () => {
  // biome-ignore lint/suspicious/noSelfCompare: because this is a test, duh
  expect(all(1 === 1, false, 'one' === 'one')).toBe(false);
});

describe('chunkArray - chunk array into arrays of n size', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = chunkArray(input, 2);
  test('chunked array length', () => {
    expect(result).toHaveLength(Math.round(input.length / 2));
  });
  test.each(result)('verify chunk %#', item => {
    expect(input).toContain(item);
  });
});

describe('entries - typed Object.entries()', () => {
  const obj = { one: 1, two: 2, three: 3 };
  const result = entries(obj);
  const expectedKeys = ['one', 'two', 'three'];
  const expectedValues = [1, 2, 3];

  test.each(result)('verify k/v pair %#', (k, v) => {
    expect(expectedKeys).toContain(k);
    expect(expectedValues).toContain(v);
  });
});

describe('dedupObjectArray - deduplicate object array', () => {
  const objArray = [
    { one: 1, two: 2, three: 3 },
    { four: 4, five: 5, six: 6 },
    { seven: 7, eight: 8, nine: 9 },
    { zero: 0, one: 1, thousand: 1_000 },
  ];
  const result = dedupObjectArray(objArray, 'one');
  test('ensure duplicate object is removed', () => {
    expect(result.length).toBe(3);
  });
  test.each(result)('verify objects', obj => {
    expect(obj).toEqual(expect.not.objectContaining(objArray[3]));
  });
});

describe('andJoin - join array of strings to sentence structure', () => {
  test('basic sentence', () => {
    const result = andJoin(['Tom', 'Dick', 'Harry']);
    expect(result).toBe('Tom, Dick, & Harry');
  });
  test('one item', () => {
    const result = andJoin(['Tom']);
    expect(result).toBe('Tom');
  });
  test('mixed types', () => {
    // @ts-expect-error Test case
    const result = andJoin(['Tom', 100, 'Harry']);
    expect(result).toBe('Tom & Harry');
  });
  test('(options) wrapped', () => {
    const result = andJoin(['Tom', 'Dick', 'Harry'], { wrap: '*' });
    expect(result).toBe('*Tom*, *Dick*, & *Harry*');
  });
  test("(options) 'and' separator", () => {
    const result = andJoin(['Tom', 'Dick', 'Harry'], { separator: 'and' });
    expect(result).toBe('Tom, Dick, and Harry');
  });
  test('(options) no oxford comma', () => {
    const result = andJoin(['Tom', 'Dick', 'Harry'], { oxfordComma: false });
    expect(result).toBe('Tom, Dick & Harry');
  });
});

describe('isFQDN - determine if a string is an FQDN pattern', () => {
  it("isn't an FQDN and should be false", () => {
    expect(isFQDN('example')).toBe(false);
  });
  it('is a domain and should be true', () => {
    expect(isFQDN('example.com')).toBe(true);
  });
  it('is a simple FQDN and should be true', () => {
    expect(isFQDN('www.example.com')).toBe(true);
  });
  it('is a long FQDN and should be true', () => {
    expect(isFQDN('one.two.example.com')).toBe(true);
  });
  it('is a longer FQDN and should be true', () => {
    expect(isFQDN('one.two.three.four.five.example.com')).toBe(true);
  });
  it('is an array of FQDNs and should be true', () => {
    expect(isFQDN(['www.example.com'])).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Answer with a promise that rejects when the request's signal aborts, as `fetch` does. */
  function hangUntilAborted(): void {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          const abort = () => reject(new DOMException('This operation was aborted', 'AbortError'));
          if (init.signal?.aborted) {
            abort();
          }
          init.signal?.addEventListener('abort', abort);
        }),
    );
  }

  /** The `RequestInit` of the `n`th `fetch` call. */
  function request(n = 0): RequestInit {
    return fetchMock.mock.calls[n][1] as RequestInit;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('passes the URL and options to fetch', async () => {
    const response = new Response('ok');
    fetchMock.mockResolvedValue(response);

    const res = await fetchWithTimeout('/api/x', { method: 'POST', mode: 'cors' }, 1000);

    expect(res).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({ method: 'POST', mode: 'cors', signal: expect.any(AbortSignal) }),
    );
  });

  it('aborts the request when the timeout passes', async () => {
    hangUntilAborted();
    const pending = fetchWithTimeout('/api/x', {}, 1000);
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    vi.advanceTimersByTime(999);
    expect(request().signal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);

    await settled;
    expect(request().signal?.aborted).toBe(true);
  });

  it('clears the timer when the request succeeds', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('/api/x', {}, 1000);

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(request().signal?.aborted).toBe(false);
  });

  it('clears the timer when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchWithTimeout('/api/x', {}, 1000)).rejects.toThrow('Failed to fetch');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives each request its own signal', async () => {
    fetchMock.mockImplementation(async () => new Response('ok'));

    await fetchWithTimeout('/api/x', {}, 1000);
    vi.advanceTimersByTime(1000);
    await fetchWithTimeout('/api/x', {}, 1000);

    expect(request(1).signal).not.toBe(request(0).signal);
    expect(request(1).signal?.aborted).toBe(false);
  });

  it('aborts the request when the passed signal aborts', async () => {
    hangUntilAborted();
    const caller = new AbortController();
    const pending = fetchWithTimeout('/api/x', { signal: caller.signal }, 1000);
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    caller.abort();

    await settled;
    expect(request().signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails at once when the passed signal has already aborted', async () => {
    hangUntilAborted();
    const caller = new AbortController();
    caller.abort();

    await expect(fetchWithTimeout('/api/x', { signal: caller.signal }, 1000)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(request().signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still times out a request that has a passed signal', async () => {
    hangUntilAborted();
    const caller = new AbortController();
    const pending = fetchWithTimeout('/api/x', { signal: caller.signal }, 1000);
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    vi.advanceTimersByTime(1000);

    await settled;
    expect(caller.signal.aborted).toBe(false);
  });
});

describe('randomId', () => {
  it('returns 32 hexadecimal characters', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a new ID each time', () => {
    expect(randomId()).not.toBe(randomId());
  });
});

describe('formatText - fill a configured text template', () => {
  test('fills named placeholders', () => {
    expect(formatText('AS{asn}', { asn: 13335 })).toBe('AS13335');
  });
  test.each(['{} {asn}', '{asn!r}'])('returns a malformed template (%s) as written', template => {
    expect(formatText(template, { asn: 13335 })).toBe(template);
  });
});
