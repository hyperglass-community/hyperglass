import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig, makeQueryClient, testConfig } from '~/__tests__/render';
import { HyperglassContext } from '~/context';
import { useFormState } from './use-form-state';
import { useLGQuery } from './use-lg-query';

import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Config, FormQuery } from '~/types';

// `fetch` is replaced in every test. `useLGQuery` reads only `requestTimeout` from the
// configuration, so the hook renders with the configuration context and React Query,
// not the full provider tree.

const query: FormQuery = {
  queryLocation: 'router_one',
  queryTarget: ['2001:db8::/32'],
  queryType: '__hyperglass_juniper_bgp_route__',
  queryVariables: {},
};

const success = {
  id: 'abc123',
  output: 'route output',
  level: 'success',
  random: 'r',
  cached: false,
  runtime: 1,
  timestamp: '2026-01-01 00:00:00',
  format: 'text/plain',
  keywords: [],
} as unknown as QueryResponse;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await useFormState.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderQuery(
  q: FormQuery = query,
  {
    config = testConfig,
    client = makeQueryClient(),
  }: { config?: Config; client?: QueryClient } = {},
) {
  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <HyperglassContext.Provider value={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </HyperglassContext.Provider>
  );
  return { ...renderHook(() => useLGQuery(q), { wrapper }), client };
}

/** The `[url, init]` of the first `fetch` call. */
function firstRequest(): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

describe('useLGQuery request', () => {
  it('posts the query as JSON to the query endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(success));
    const { result } = renderQuery({
      ...query,
      queryLocation: 'router_three',
      queryType: 'peer_communities',
      queryTarget: ['65000:1'],
      queryVariables: { vrf: 'default' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = firstRequest();
    expect(url).toBe('/api/query');
    expect(init.method).toBe('POST');
    expect(init.mode).toBe('cors');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      queryLocation: 'router_three',
      queryTarget: ['65000:1'],
      queryType: 'peer_communities',
      queryVariables: { vrf: 'default' },
    });
  });

  it('sends empty query variables when the query has none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(success));
    const { queryVariables: _, ...withoutVariables } = query;
    const { result } = renderQuery(withoutVariables as FormQuery);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(firstRequest()[1].body as string).queryVariables).toEqual({});
  });

  it('caches the response under the query, without refetching', async () => {
    fetchMock.mockResolvedValue(jsonResponse(success));
    const { result, client, rerender } = renderQuery();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    expect(client.getQueryData(['/api/query', query])).toEqual(success);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('useLGQuery responses', () => {
  it('returns the response body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(success));
    const { result } = renderQuery();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(success);
    expect(result.current.error).toBeNull();
  });

  it('returns a JSON error body from the backend as data, not as an error', async () => {
    // The backend answers errors with a JSON body that has a `level`; the results view
    // reads the message from it. The hook does not look at the HTTP status.
    const body = {
      output: '192.0.2.0/24 is not allowed.',
      level: 'danger',
      keywords: ['192.0.2.0/24'],
    };
    fetchMock.mockResolvedValue(jsonResponse(body, { status: 400, statusText: 'Bad Request' }));
    const { result } = renderQuery();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(body);
  });

  it('fails with the status text when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    const { result } = renderQuery();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('Bad Gateway');
  });

  it('fails with the network error when the request cannot be sent', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderQuery();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch');
  });
});

describe('useLGQuery timeout', () => {
  /**
   * Answer every request with a promise that rejects when its signal aborts, as `fetch`
   * does. Capture the timer `fetchWithTimeout` starts instead of scheduling it, so the
   * test can fire it.
   */
  function captureTimeout(delay: number): { fire(): void; delays: number[] } {
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
    const realSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    let timeout: (() => void) | null = null;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === delay) {
        delays.push(ms);
        timeout = fn;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout);
    return {
      delays,
      fire() {
        if (timeout === null) {
          throw new Error('No request timeout was set');
        }
        timeout();
      },
    };
  }

  it('aborts the request after the configured request timeout', async () => {
    const config = makeConfig({ requestTimeout: 7 });
    const timer = captureTimeout(7000);
    const { result } = renderQuery(query, { config });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(timer.delays).toEqual([7000]);
    expect(result.current.isLoading).toBe(true);

    act(() => timer.fire());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(firstRequest()[1].signal?.aborted).toBe(true);
    // The error is the abort, not a "timeout" message. The results view maps an error to
    // `messages.requestTimeout` only when its message starts with "timeout", so a timed
    // out query does not show the configured message.
    const error = result.current.error as DOMException;
    expect(error.name).toBe('AbortError');
    expect(error.message.toLowerCase().startsWith('timeout')).toBe(false);
  });

  it('fails a refetch once the first request timeout has passed', async () => {
    // Current behaviour, likely a bug: the hook keeps one AbortController for its life,
    // and `fetchWithTimeout` never clears its timer. The timer aborts that controller
    // even after the request succeeded, so every later refetch fails at once.
    const delay = testConfig.requestTimeout * 1000;
    const timer = captureTimeout(delay);
    fetchMock.mockImplementationOnce(async () => jsonResponse(success));
    const { result } = renderQuery();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => timer.fire());
    await act(async () => {
      await result.current.refetch();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as DOMException).name).toBe('AbortError');
  });

  it('aborts a running request on unmount', async () => {
    captureTimeout(testConfig.requestTimeout * 1000);
    const { unmount } = renderQuery();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    unmount();

    expect(firstRequest()[1].signal?.aborted).toBe(true);
  });
});

describe('useLGQuery enrichment polling', () => {
  const pending = { ...success, enrichment: 'pending' } as unknown as QueryResponse;
  const enrichmentUrl = `/api/query/${success.id}/enrichment`;

  function enrichmentCalls(): unknown[][] {
    return fetchMock.mock.calls.filter(([url]) => url === enrichmentUrl);
  }

  /**
   * Capture the one-second poll interval instead of scheduling it, so a test runs each
   * poll itself. Testing Library's `waitFor` polls with `setInterval` too, so fake
   * timers would stop it; other intervals are passed through.
   */
  function captureInterval(): { tick(): Promise<void>; isCleared(): boolean } {
    const realSetInterval = window.setInterval;
    const realClearInterval = window.clearInterval;
    const id = 424242;
    let callback: (() => void) | null = null;
    let cleared = false;
    vi.spyOn(window, 'setInterval').mockImplementation(((
      fn: () => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 1000) {
        callback = fn;
        cleared = false;
        return id;
      }
      return realSetInterval(fn, ms, ...args);
    }) as typeof window.setInterval);
    vi.spyOn(window, 'clearInterval').mockImplementation(
      (handle?: Parameters<typeof window.clearInterval>[0]) => {
        if (handle === id) {
          cleared = true;
          return;
        }
        realClearInterval(handle);
      },
    );
    return {
      async tick() {
        if (callback === null || cleared) {
          throw new Error('The poll interval is not running');
        }
        const run = callback;
        await act(async () => run());
      },
      isCleared: () => cleared,
    };
  }

  it('does not poll a response without pending enrichment', async () => {
    fetchMock.mockResolvedValue(jsonResponse(success));
    const { result } = renderQuery();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(enrichmentCalls()).toHaveLength(0);
  });

  it('replaces the output when the enrichment completes', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === enrichmentUrl
        ? jsonResponse({ status: 'complete', output: 'enriched output' })
        : jsonResponse(pending),
    );
    const { result, client } = renderQuery();

    await waitFor(() => expect(result.current.data?.enrichment).toBe('complete'));
    const updated = { ...pending, enrichment: 'complete', output: 'enriched output' };
    expect(result.current.data).toEqual(updated);
    expect(client.getQueryData(['/api/query', query])).toEqual(updated);
    expect(useFormState.getState().response(query.queryLocation)).toEqual(updated);
    expect(enrichmentCalls()[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('keeps the output when the enrichment completes without one', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === enrichmentUrl ? jsonResponse({ status: 'failed' }) : jsonResponse(pending),
    );
    const { result } = renderQuery();

    await waitFor(() => expect(result.current.data?.enrichment).toBe('failed'));
    expect(result.current.data?.output).toBe(success.output);
  });

  it('polls every second while the enrichment is pending', async () => {
    const interval = captureInterval();
    let polls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== enrichmentUrl) {
        return jsonResponse(pending);
      }
      polls += 1;
      return jsonResponse(polls < 3 ? { status: 'pending' } : { status: 'complete' });
    });
    const { result } = renderQuery();

    // The first poll runs at once, the next ones on the interval.
    await waitFor(() => expect(polls).toBe(1));
    expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    await interval.tick();
    await waitFor(() => expect(polls).toBe(2));
    expect(result.current.data?.enrichment).toBe('pending');

    await interval.tick();
    await waitFor(() => expect(result.current.data?.enrichment).toBe('complete'));
    // The interval stops once the enrichment is no longer pending.
    await waitFor(() => expect(interval.isCleared()).toBe(true));
    expect(polls).toBe(3);
  });

  it('stops polling when the backend no longer knows the query', async () => {
    const interval = captureInterval();
    fetchMock.mockImplementation(async (url: string) =>
      url === enrichmentUrl ? jsonResponse({ status: 'not_found' }) : jsonResponse(pending),
    );
    const { result } = renderQuery();

    await waitFor(() => expect(interval.isCleared()).toBe(true));
    expect(enrichmentCalls()).toHaveLength(1);
    expect(result.current.data?.enrichment).toBe('pending');
  });

  it('keeps polling after a failed poll response', async () => {
    const interval = captureInterval();
    let polls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== enrichmentUrl) {
        return jsonResponse(pending);
      }
      polls += 1;
      return polls === 1
        ? new Response('', { status: 503 })
        : jsonResponse({ status: 'complete', output: 'enriched output' });
    });
    const { result } = renderQuery();

    await waitFor(() => expect(polls).toBe(1));
    expect(result.current.data?.enrichment).toBe('pending');
    await interval.tick();
    await waitFor(() => expect(result.current.data?.output).toBe('enriched output'));
  });

  it('logs a poll that throws and keeps the response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === enrichmentUrl) {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(pending);
    });
    const { result } = renderQuery();

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Failed to poll query enrichment',
        expect.objectContaining({ message: 'Failed to fetch' }),
      ),
    );
    expect(result.current.data?.enrichment).toBe('pending');
  });

  it('stops polling on unmount', async () => {
    const interval = captureInterval();
    fetchMock.mockImplementation(async (url: string) =>
      url === enrichmentUrl ? jsonResponse({ status: 'pending' }) : jsonResponse(pending),
    );
    const { unmount } = renderQuery();
    await waitFor(() => expect(enrichmentCalls()).toHaveLength(1));

    unmount();

    expect(interval.isCleared()).toBe(true);
    expect((enrichmentCalls()[0][1] as RequestInit).signal?.aborted).toBe(true);
  });
});
