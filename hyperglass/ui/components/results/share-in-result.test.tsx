import { Accordion } from '@chakra-ui/react';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { useFormState } from '~/hooks';
import { useShareLinks } from '~/hooks/use-share-links';
import { formatTimestamp } from '~/util';
import { Result } from './individual';

import type { Config } from '~/types';

// The live `Result` shows a Share button (#561) only for a result the server would share.

const initialFormState = useFormState.getState();
const JUNIPER_ROUTE = '__hyperglass_juniper_bgp_route__';
const QUERY_ID = `hyperglass.query.${'ef'.repeat(32)}`;
const SHARE_ID = '00112233445566778899aabbccddeeff';
const TOKEN = 'n0t-1n-th3-url_0r-l0gs_7h3-d3l3t3-t0k3n-xyz12';

const form = {
  queryLocation: ['router_one'],
  queryTarget: ['2001:db8::/32'],
  queryType: JUNIPER_ROUTE,
  queryVariables: {},
};

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: QUERY_ID,
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-23 08:00:00',
    keywords: [],
    output: 'show route 2001:db8::/32\n2001:db8::/32 *[BGP/170] via 2001:db8:ffff::1',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

/**
 * A `fetch` stub: `/api/query` gets `query` (or fails with it when it is an `Error`), and
 * `POST /api/share` creates share `SHARE_ID`.
 */
function stubFetch(query: QueryResponse | Error = response(), enrichment = { status: 'pending' }) {
  const impl = vi.fn(async (url: string) => {
    if (url.endsWith('/enrichment')) {
      return new Response(JSON.stringify(enrichment), { status: 200 });
    }
    if (url === '/api/share') {
      return new Response(
        JSON.stringify({ id: SHARE_ID, expiresAt: '2026-12-23T08:00:00Z', deleteToken: TOKEN }),
        { status: 201 },
      );
    }
    if (query instanceof Error) {
      throw query;
    }
    return { ok: true, json: async () => query, statusText: 'OK' } as Response;
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

/** The test configuration with sharing on, and `retain: false` on the directives `ids`. */
function config({ enable = true, unretained = [] as string[] } = {}): Config {
  const result = makeConfig({ share: { enable } });
  result.devices = result.devices.map(group => ({
    ...group,
    locations: group.locations.map(location => ({
      ...location,
      directives: location.directives.map(d =>
        unretained.includes(d.id) ? { ...d, retain: false } : d,
      ),
    })),
  }));
  return result;
}

function header(): HTMLElement {
  return screen.getByRole('button', { name: /Router One/ });
}

/** The buttons next to the result's header. */
function actionButtons(): HTMLElement[] {
  const row = header().parentElement as HTMLElement;
  return Array.from(row.querySelectorAll<HTMLElement>('.chakra-button'));
}

async function renderResult(cfg: Config = config()): Promise<void> {
  renderWithProviders(
    <Accordion allowMultiple>
      <Result index={0} queryLocation="router_one" />
    </Accordion>,
    { config: cfg },
  );
  await waitFor(() => expect(header()).toBeEnabled(), IMPORT_WAIT);
  await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'true'), IMPORT_WAIT);
  // The copy and requery buttons' icons load through `next/dynamic`.
  await waitFor(
    () =>
      expect(header().parentElement?.querySelectorAll('.chakra-button svg').length).toBe(
        actionButtons().length,
      ),
    IMPORT_WAIT,
  );
}

const shareButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'Share Result' });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useFormState.setState({ ...initialFormState, form, status: 'results' }, true);
});

afterEach(() => {
  cleanup();
  useFormState.setState(initialFormState, true);
  useShareLinks.setState({ links: {} });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Result Share button', () => {
  it('follows copy and requery for a successful result when sharing is enabled', async () => {
    stubFetch();
    await renderResult();
    expect(actionButtons()).toEqual([
      screen.getByRole('button', { name: 'Copy Output' }),
      screen.getByRole('button', { name: 'Reload Query' }),
      shareButton(),
    ]);
  });

  it('is absent when sharing is disabled', async () => {
    stubFetch();
    await renderResult(config({ enable: false }));
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeInTheDocument();
    expect(shareButton()).toBeNull();
  });

  it.each([
    ['an error response', response({ level: 'error', output: 'Not allowed.' })],
    ['a warning response', response({ level: 'warning', output: 'No output.' })],
    ['a failed request', new Error('network unreachable')],
  ])('is absent for %s', async (_, query) => {
    stubFetch(query);
    await renderResult();
    expect(shareButton()).toBeNull();
  });

  it('is absent while enrichment is pending, and shown once it completes', async () => {
    const enrichment = { status: 'pending' };
    const fetch = stubFetch(response({ enrichment: 'pending' }), enrichment);
    await renderResult(config());
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/enrichment'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeInTheDocument();
    expect(shareButton()).toBeNull();

    enrichment.status = 'complete';
    expect(
      await screen.findByRole('button', { name: 'Share Result' }, IMPORT_WAIT),
    ).toBeInTheDocument();
  });

  it('is shown when enrichment failed, which the server shares', async () => {
    stubFetch(response({ enrichment: 'failed' }));
    await renderResult();
    expect(shareButton()).toBeInTheDocument();
  });

  it('is absent for a directive with retain: false', async () => {
    stubFetch();
    await renderResult(config({ unretained: [JUNIPER_ROUTE] }));
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeInTheDocument();
    expect(shareButton()).toBeNull();
  });

  it('is shown when only another directive has retain: false', async () => {
    stubFetch();
    await renderResult(config({ unretained: ['__hyperglass_arista_eos_bgp_route__'] }));
    expect(shareButton()).toBeInTheDocument();
  });

  it('is disabled while the query runs again', async () => {
    let release: () => void = () => undefined;
    let queries = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url !== '/api/query') {
          return new Response('{}', { status: 404 });
        }
        queries += 1;
        if (queries === 1) {
          return { ok: true, json: async () => response(), statusText: 'OK' } as Response;
        }
        return new Promise<Response>(resolve => {
          release = () =>
            resolve({
              ok: true,
              json: async () => response({ timestamp: '2026-11-23 08:05:00' }),
              statusText: 'OK',
            } as Response);
        });
      }),
    );
    await renderResult();
    expect(shareButton()).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Reload Query' }));
    await waitFor(() => expect(shareButton()).toBeDisabled());
    await act(async () => release());
    await waitFor(() => expect(shareButton()).toBeEnabled());
  });

  it('keeps a link to the result from before a forced refresh reachable', async () => {
    let queries = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/share') {
          return new Response(
            JSON.stringify({ id: SHARE_ID, expiresAt: '2026-12-23T08:00:00Z', deleteToken: TOKEN }),
            { status: 201 },
          );
        }
        queries += 1;
        const timestamp = queries === 1 ? '2026-11-23 08:00:00' : '2026-11-23 08:05:00';
        return {
          ok: true,
          json: async () => response({ timestamp }),
          statusText: 'OK',
        } as Response;
      }),
    );
    await renderResult();
    await userEvent.click(shareButton() as HTMLElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Create Link' }));
    await screen.findByRole('textbox', { name: 'Link to this result' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Reload Query' }));
    await waitFor(() => expect(queries).toBe(2));
    await waitFor(() => expect(shareButton()).toBeEnabled());
    await userEvent.click(shareButton() as HTMLElement);
    expect(
      await screen.findByRole('textbox', {
        name: `Link to the result from ${formatTimestamp('2026-11-23 08:00:00')}`,
      }),
    ).toHaveValue(`${window.location.origin}/?share=${SHARE_ID}`);
    expect(screen.getByRole('button', { name: 'Create Link' })).toBeInTheDocument();
  });

  it('shares the response by its id, and keeps the link for this page', async () => {
    const fetch = stubFetch();
    await renderResult();
    await userEvent.click(shareButton() as HTMLElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Create Link' }));
    const link = `${window.location.origin}/?share=${SHARE_ID}`;
    const field = await screen.findByRole('textbox', { name: 'Link to this result' });
    expect(field).toHaveValue(link);

    const shares = fetch.mock.calls.filter(([url]) => url === '/api/share');
    expect(shares).toHaveLength(1);
    const [, init] = shares[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      queryId: QUERY_ID,
      timestamp: '2026-11-23 08:00:00',
      expiresIn: 2592000,
    });

    // Closed and opened again: the same link, without another request.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(shareButton() as HTMLElement);
    expect(await screen.findByRole('textbox', { name: 'Link to this result' })).toHaveValue(link);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/share')).toHaveLength(1);
    // The IPv6 target is in the shared result, never in the link.
    expect(link).not.toContain('2001');
  });
});
