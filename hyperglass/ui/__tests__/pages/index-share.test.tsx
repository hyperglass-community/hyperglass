import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { Layout } from '~/components/layout';
import { useFormState, useGreeting, useHistoryView, useQueryHistory, useShareView } from '~/hooks';
import { formatTimestamp } from '~/util';
import Index from '../../pages/index';

import type { Snapshot } from '~/hooks';
import type { Config } from '~/types';

// The shared result page (#560): `/?share=<id>` shows a snapshot from `GET /api/share/<id>`
// (S1, #559) read-only, in place of the form. The page chrome is stubbed as in the history
// tests; `Layout`, the index page and the form are real.
vi.mock('~/components', async importOriginal => ({
  ...(await importOriginal<typeof import('~/components')>()),
  Debugger: () => null,
  Footer: () => null,
  Greeting: () => null,
  Header: () => null,
}));
// The chart needs a layout engine that jsdom lacks.
vi.mock('~/components/path/chart', () => ({ Chart: () => null }));

// Next.js updates the address on `replace`; the stub does the same.
const router = vi.hoisted(() => ({
  isReady: true,
  pathname: '/',
  replace: vi.fn(async (url: string, as?: string) => {
    window.history.replaceState(window.history.state, '', as ?? url);
    return true;
  }),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));

const ID = '0123456789abcdef0123456789abcdef';
const { text } = testConfig.web;
const { messages } = testConfig;
const initialFormState = useFormState.getState();

const EMPTY_FORM = { queryLocation: [], queryType: '', queryTarget: [], queryVariables: {} };

type Result = Snapshot['results'][number];

function textResult(target: string | string[] = '192.0.2.0/24'): Result {
  return {
    query: {
      location: 'router_one',
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTypeName: 'BGP Route',
      target,
      variables: {},
    },
    labels: { location: 'Router One', queryType: 'BGP Route' },
    output: 'shared route output',
    format: 'text/plain',
    timestamp: '2026-11-20 08:00:00',
    runtime: 3,
  };
}

function route(overrides: Partial<Route> = {}): Route {
  return {
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
    ...overrides,
  };
}

function bgpResult(routes: Route[] = [route()], organizations = {}): Result {
  return {
    ...textResult('2001:db8::/32'),
    output: {
      vrf: 'default',
      count: routes.length,
      routes,
      winning_weight: 'high',
      asn_organizations: organizations,
    },
    format: 'application/json',
  };
}

function tracerouteResult(hostname: string): Result {
  const hop = {
    hop_number: 1,
    ip_address: '2001:db8::5',
    display_ip: '2001:db8::5',
    hostname,
    rtt1: 1,
    rtt2: 1,
    rtt3: 1,
    loss_pct: 0,
    sent_count: 3,
    last_rtt: 1,
    avg_rtt: 1,
    best_rtt: 1,
    worst_rtt: 1,
    asn: '65000',
    org: null,
    prefix: null,
    country: null,
    rir: null,
    allocated: null,
  };
  return {
    query: {
      location: 'router_one',
      queryType: '__hyperglass_juniper_traceroute__',
      queryTypeName: 'Traceroute',
      target: '2001:db8::5',
      variables: {},
    },
    labels: { location: 'Router One', queryType: 'Traceroute' },
    output: {
      vrf: 'default',
      target: '2001:db8::5',
      source: '2001:db8::1',
      hops: [hop],
      max_hops: 30,
      packet_size: 64,
      raw_output: null,
    },
    format: 'application/json',
    timestamp: '2026-11-20 08:00:00',
    runtime: 3,
  };
}

/** A snapshot in S1's exact shape, as `GET /api/share/{id}` returns it. */
function snapshot(result: Result = textResult()): Snapshot {
  return {
    id: ID,
    version: 1,
    createdAt: '2026-11-20T08:05:00Z',
    expiresAt: '2026-12-20T08:05:00Z',
    results: [result],
  };
}

let fetch: ReturnType<typeof vi.fn>;
/** What `next/head` was last asked to render. */
let head: React.ReactElement[];

/** Answer `GET /api/share/<id>` with this status and body. */
function answer(status: number, body: unknown): void {
  fetch.mockImplementation(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  }));
}

function urls(): string[] {
  return fetch.mock.calls.map(([url]) => String(url));
}

function queries(): Record<string, unknown>[] {
  return fetch.mock.calls
    .filter(([url]) => String(url).includes('/api/query'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function noindex(): boolean {
  return head.some(
    el => el.type === 'meta' && el.props.name === 'robots' && el.props.content === 'noindex',
  );
}

/** Open the page at this address. */
function openPage(address: string, config?: Config) {
  window.history.replaceState(null, '', address);
  const headManager = {
    mountedInstances: new Set(),
    updateHead: (elements: React.ReactElement[]) => {
      head = elements;
    },
  };
  return renderWithProviders(
    <HeadManagerContext.Provider value={headManager as never}>
      <Layout>
        <Index />
      </Layout>
    </HeadManagerContext.Provider>,
    { config },
  );
}

async function sharedSection(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: text.shareTitle }, IMPORT_WAIT);
}

/** Wait for anything the page might still send. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });
}

async function submitButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: 'Submit Query' }, IMPORT_WAIT);
}

beforeEach(() => {
  head = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
  fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/query')) {
      const body = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          id: 'live',
          random: 'r',
          cached: false,
          runtime: 1,
          level: 'success',
          timestamp: '2026-11-23 10:00:00',
          keywords: [],
          output: `live output of ${body.queryLocation}`,
          format: 'text/plain',
          enrichment: 'complete',
        }),
      };
    }
    return new Promise(() => undefined);
  });
  vi.stubGlobal('fetch', fetch);
  act(() => {
    useGreeting.setState({ isAck: true, isOpen: false, greetingReady: true });
  });
});

afterEach(() => {
  act(() => {
    useFormState.setState(initialFormState, true);
    useShareView.setState({ id: null });
    useQueryHistory.setState({ entries: [] });
    useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  router.replace.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Shared result page', () => {
  it('shows a shared text result read-only, with its time and expiry', async () => {
    answer(200, snapshot());
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    expect(
      await within(section).findByText('shared route output', undefined, IMPORT_WAIT),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(
        text.shareResultTime.replace('{time}', formatTimestamp('2026-11-20 08:00:00')),
      ),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(
        text.shareExpires.replace('{time}', formatTimestamp('2026-12-20T08:05:00Z')),
      ),
    ).toBeInTheDocument();
    // The query type, the target and the location's name.
    expect(within(section).getByText('BGP Route')).toBeInTheDocument();
    expect(within(section).getByText('192.0.2.0/24')).toBeInTheDocument();
    expect(within(section).getByText('Router One')).toBeInTheDocument();
    // Copy, but no requery and no cache countdown.
    expect(within(section).getByRole('button', { name: text.copyOutput })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.reloadQuery })).not.toBeInTheDocument();
    expect(screen.queryByText(text.cachePrefix.trim(), { exact: false })).not.toBeInTheDocument();
    // In place of the form and the saved queries.
    expect(screen.queryByRole('button', { name: 'Submit Query' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();

    await settle();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/share/${ID}`);
    expect(init.method).toBe('GET');
  });

  it('shows a structured BGP table for an IPv6 target, with an AS path that looks nothing up', async () => {
    answer(200, snapshot(bgpResult()));
    // With AS path enrichment on, the live results look up ASN names when the path opens.
    openPage(`/?share=${ID}`, makeConfig({ web: { aspathEnrichment: true } }));

    const section = await sharedSection();
    expect(
      await within(section).findByText('2001:db8::1', undefined, IMPORT_WAIT),
    ).toBeInTheDocument();
    expect(within(section).getAllByText('2001:db8::/32').length).toBeGreaterThan(0);
    const path = await within(section).findByRole('button', { name: text.viewAsPath }, IMPORT_WAIT);
    await userEvent.click(path);
    await settle();
    expect(urls()).toEqual([`/api/share/${ID}`]);
  });

  it('shows the targets of a query with several, IPv4 and IPv6', async () => {
    answer(200, snapshot(textResult(['192.0.2.1', '2001:db8::1'])));
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    expect(
      await within(section).findByText('192.0.2.1, 2001:db8::1', undefined, IMPORT_WAIT),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'a community and an AS name',
      bgpResult(
        [
          route({
            communities: ['<img src="x" onerror="window.pwned=1">', '65000:2,<b>name</b>'],
            as_path: [65000, 64999],
          }),
        ],
        { '64999': { name: '<script>window.pwned=1</script>' } },
      ),
      ['<img src="x" onerror="window.pwned=1">', '65000:2 - <b>name</b>'],
    ],
    [
      'a reverse DNS name',
      tracerouteResult('<img src="x" onerror="window.pwned=1">.example.com'),
      ['<img src="x" onerror="window.pwned=1">.example.com'],
    ],
    ['text output', textResult(), []],
  ])('shows markup in %s as text', async (_, result, shown) => {
    const value =
      result.format === 'text/plain'
        ? { ...result, output: '<script>window.pwned=1</script><img src="x">' }
        : result;
    answer(200, snapshot(value));
    const { container } = openPage(`/?share=${ID}`);

    const section = await sharedSection();
    await waitFor(
      () => expect(section.querySelector('[role="table"], table, pre')).not.toBeNull(),
      IMPORT_WAIT,
    );
    for (const literal of shown) {
      expect(within(section).getAllByText(literal, { exact: false }).length).toBeGreaterThan(0);
    }
    if (result.format === 'text/plain') {
      expect(section.querySelector('pre')).toHaveTextContent(
        '<script>window.pwned=1</script><img src="x">',
      );
    }
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    await settle();
    expect(urls()).toEqual([`/api/share/${ID}`]);
  });

  it('shows the loading text until the snapshot arrives', async () => {
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(text.shareLoading),
    );
    // Only the configured text: the spinner adds no label of its own.
    expect(within(section).getByRole('status').textContent).toBe(text.shareLoading);
    expect(screen.queryByRole('button', { name: text.shareRunQuery })).not.toBeInTheDocument();
  });

  it('moves focus to the shared result heading when it opens', async () => {
    answer(200, snapshot());
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    const heading = within(section).getByRole('heading', { name: text.shareTitle });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it.each([
    ['an empty route', { routes: [{}] }],
    ['an object in the communities', { routes: [{ ...route(), communities: [{}] }] }],
    ['an object in the AS path', { routes: [{ ...route(), as_path: [{}] }] }],
    ['an empty hop', { hops: [{}] }],
  ])(
    'shows the error text, and keeps the page, for structured output with %s',
    async (_, output) => {
      const result = bgpResult();
      answer(200, snapshot({ ...result, output: output as never }));
      openPage(`/?share=${ID}`);

      const section = await sharedSection();
      expect(await within(section).findByRole('alert')).toHaveTextContent(text.shareError);
      await userEvent.click(within(section).getByRole('button', { name: text.shareNewQuery }));
      await screen.findAllByText('Router One', undefined, IMPORT_WAIT);
      expect(urls()).toEqual([`/api/share/${ID}`]);
    },
  );

  it.each([
    ['not found', 404, () => messages.shareNotFound],
    ['an unsupported version', 422, () => messages.shareUnsupported],
    ['rate limited', 429, () => messages.rateLimited],
    ['a server error', 500, () => text.shareError],
    ['unavailable', 503, () => text.shareError],
  ])('shows the configured text when %s (HTTP %i)', async (_, status, expected) => {
    // The response's own text is never shown.
    answer(status, { output: 'server text', level: 'danger' });
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    expect(await within(section).findByRole('alert')).toHaveTextContent(expected());
    expect(screen.queryByText('server text')).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: text.shareNewQuery })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.shareRunQuery })).not.toBeInTheDocument();
    await settle();
    expect(urls()).toEqual([`/api/share/${ID}`]);
  });

  it('shows the error text when the request fails', async () => {
    fetch.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    expect(await within(section).findByRole('alert')).toHaveTextContent(text.shareError);
    await settle();
    expect(urls()).toEqual([`/api/share/${ID}`]);
  });

  it('shows the error text for a response that is not a snapshot', async () => {
    answer(200, { ...snapshot(), results: [{ output: 42 }] });
    openPage(`/?share=${ID}`);

    const section = await sharedSection();
    expect(await within(section).findByRole('alert')).toHaveTextContent(text.shareError);
  });

  it.each([
    ['empty', ''],
    ['too short', ID.slice(1)],
    ['in capitals', ID.toUpperCase()],
    ['a path', '../query'],
    ['an id with a path after it', `${ID}/../../query`],
  ])('shows not found without a request for an id that is %s', async (_, id) => {
    openPage(`/?share=${encodeURIComponent(id)}`);

    const section = await sharedSection();
    expect(await within(section).findByRole('alert')).toHaveTextContent(messages.shareNotFound);
    await settle();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the configured text', async () => {
    const config = makeConfig({
      web: {
        text: {
          shareTitle: 'Résultat partagé',
          shareResultTime: 'Résultat du {time}',
          shareExpires: 'Expire le {time}',
          shareRunQuery: 'Lancer',
          shareNewQuery: 'Nouvelle requête',
        },
      },
    });
    answer(200, snapshot());
    openPage(`/?share=${ID}`, config);

    const section = await screen.findByRole('region', { name: 'Résultat partagé' }, IMPORT_WAIT);
    expect(
      await within(section).findByText(
        `Résultat du ${formatTimestamp('2026-11-20 08:00:00')}`,
        undefined,
        IMPORT_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(`Expire le ${formatTimestamp('2026-12-20T08:05:00Z')}`),
    ).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Lancer' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Nouvelle requête' })).toBeInTheDocument();
  });

  it('uses the configured loading and error text', async () => {
    const config = makeConfig({
      web: { text: { shareLoading: 'Chargement', shareError: 'Erreur' } },
      messages: { shareNotFound: 'Introuvable' },
    });
    openPage(`/?share=${ID}`, config);
    const status = await screen.findByRole('status', undefined, IMPORT_WAIT);
    await waitFor(() => expect(status).toHaveTextContent('Chargement'));
  });

  it('asks search engines not to index the page while a share shows', async () => {
    answer(200, snapshot());
    openPage(`/?share=${ID}`);
    const section = await sharedSection();
    await waitFor(() => expect(noindex()).toBe(true));

    await userEvent.click(
      await within(section).findByRole('button', { name: text.shareNewQuery }, IMPORT_WAIT),
    );

    await screen.findAllByText('Router One', undefined, IMPORT_WAIT);
    await waitFor(() => expect(noindex()).toBe(false));
  });

  it('does not ask search engines to skip the landing page', async () => {
    openPage('/');
    await screen.findAllByText('Router One', undefined, IMPORT_WAIT);
    await settle();
    expect(noindex()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never reads or shows a delete token, and keeps nothing in the browser', async () => {
    answer(200, { ...snapshot(), deleteToken: 'the-delete-token' });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { container } = openPage(`/?share=${ID}`);

    await within(await sharedSection()).findByText('shared route output', undefined, IMPORT_WAIT);
    expect(container).not.toHaveTextContent('the-delete-token');
    expect(window.location.href).not.toContain('the-delete-token');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init.headers ?? {}).toLowerCase()).not.toContain('delete');
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('the-delete-token');
  });

  it('puts the share id in no link on the page', async () => {
    answer(200, snapshot(bgpResult()));
    const { container } = openPage(`/?share=${ID}`);
    const section = await sharedSection();
    await within(section).findByText('2001:db8::1', undefined, IMPORT_WAIT);

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'));
    // The ASN links of the table go to another site: without the share id.
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href).not.toContain(ID);
    }
  });
});

describe('Prefill parameters alongside share', () => {
  const prefill =
    'location=router_two&type=__hyperglass_arista_eos_ping__&target=198.51.100.7&var.vrf=default';
  const address = `/?share=${ID}&${prefill}&utm=1`;

  it('ignores them and removes them from the address', async () => {
    answer(200, snapshot());
    openPage(address);

    await within(await sharedSection()).findByText('shared route output', undefined, IMPORT_WAIT);
    await waitFor(() => expect(window.location.search).toBe(`?share=${ID}&utm=1`));
    expect(useFormState.getState().form).toEqual(EMPTY_FORM);
  });

  it('ignores them for a share that is not found', async () => {
    answer(404, {});
    openPage(address);

    await within(await sharedSection()).findByRole('alert');
    await waitFor(() => expect(window.location.search).toBe(`?share=${ID}&utm=1`));
    expect(useFormState.getState().form).toEqual(EMPTY_FORM);
  });

  it('does not apply them once the shared result is left', async () => {
    answer(200, snapshot());
    openPage(address);
    const section = await sharedSection();

    await userEvent.click(
      await within(section).findByRole('button', { name: text.shareNewQuery }, IMPORT_WAIT),
    );

    await screen.findAllByText('Router Two', undefined, IMPORT_WAIT);
    await settle();
    expect(useFormState.getState().form).toEqual(EMPTY_FORM);
    expect(window.location.search).toBe('?utm=1');
  });
});

describe('Run this query', () => {
  it('does not submit while Enter is held down from Run this query', async () => {
    answer(200, snapshot(textResult('2001:db8::/32')));
    openPage(`/?share=${ID}`);
    const section = await sharedSection();
    const run = await within(section).findByRole(
      'button',
      { name: text.shareRunQuery },
      IMPORT_WAIT,
    );

    // A held key: the first keydown activates Run this query; the browser repeats the
    // keydown, with `repeat` set, on whatever has focus next.
    run.focus();
    await userEvent.keyboard('{Enter}');
    const submit = await submitButton();
    await waitFor(() => expect(submit).toHaveFocus());
    const target = await screen.findByPlaceholderText(
      'IP Address, Prefix, or Hostname',
      undefined,
      IMPORT_WAIT,
    );

    // `fireEvent` returns false when the default action (button activation, implicit
    // submission) was prevented.
    expect(fireEvent.keyDown(submit, { key: 'Enter', code: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(target, { key: 'Enter', code: 'Enter', repeat: true })).toBe(false);
    await settle();
    expect(queries()).toEqual([]);
    expect(useFormState.getState().status).toBe('form');

    // A new press is a deliberate action.
    expect(fireEvent.keyDown(submit, { key: 'Enter', code: 'Enter' })).toBe(true);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(queries()).toHaveLength(1));
  });

  it.each([
    ['an IPv4 prefix', '192.0.2.0/24'],
    ['an IPv6 prefix', '2001:db8::/32'],
  ])(
    'fills the form with the shared query for %s, and leaves submitting to the visitor',
    async (_, target) => {
      answer(200, snapshot(textResult(target)));
      openPage(`/?share=${ID}`);
      const section = await sharedSection();

      await userEvent.click(
        await within(section).findByRole('button', { name: text.shareRunQuery }, IMPORT_WAIT),
      );

      const submit = await submitButton();
      expect(
        await screen.findByPlaceholderText(
          'IP Address, Prefix, or Hostname',
          undefined,
          IMPORT_WAIT,
        ),
      ).toHaveValue(target);
      expect(useFormState.getState().form).toEqual({
        queryLocation: ['router_one'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTarget: [target],
        queryVariables: {},
      });
      expect(screen.queryByRole('region', { name: text.shareTitle })).not.toBeInTheDocument();
      await waitFor(() => expect(submit).toHaveFocus());
      await waitFor(() => expect(window.location.search).toBe(''));
      await settle();
      expect(useFormState.getState().status).toBe('form');
      expect(queries()).toEqual([]);

      await userEvent.click(submit);

      await waitFor(() =>
        expect(queries()).toEqual([
          {
            queryLocation: 'router_one',
            queryType: '__hyperglass_juniper_bgp_route__',
            queryTarget: [target],
            queryVariables: {},
          },
        ]),
      );
    },
  );

  it('does not get past a required greeting', async () => {
    act(() => {
      useGreeting.setState({ isAck: false, greetingReady: false });
    });
    answer(200, snapshot());
    const config = makeConfig({ web: { greeting: { enable: true, required: true } } });
    openPage(`/?share=${ID}`, config);
    const section = await sharedSection();

    await userEvent.click(
      await within(section).findByRole('button', { name: text.shareRunQuery }, IMPORT_WAIT),
    );
    const submit = await submitButton();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);

    await userEvent.click(submit);

    // The form's submit path reloads the page, which shows the greeting again.
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(queries()).toEqual([]);
  });

  it('fills what the configuration still offers, and reports the query type that is gone', async () => {
    const result = textResult();
    answer(
      200,
      snapshot({
        ...result,
        query: { ...result.query, queryType: 'gone', queryTypeName: 'Gone' },
      }),
    );
    openPage(`/?share=${ID}`);
    const section = await sharedSection();

    await userEvent.click(
      await within(section).findByRole('button', { name: text.shareRunQuery }, IMPORT_WAIT),
    );

    await submitButton();
    await waitFor(() => expect(useFormState.getState().form.queryLocation).toEqual(['router_one']));
    expect(useFormState.getState().form.queryType).toBe('');
    await settle();
    expect(queries()).toEqual([]);
  });
});

describe('New query', () => {
  it('shows an empty form without the share in the address', async () => {
    answer(200, snapshot());
    openPage(`/?share=${ID}`);
    const section = await sharedSection();

    await userEvent.click(
      await within(section).findByRole('button', { name: text.shareNewQuery }, IMPORT_WAIT),
    );

    await screen.findAllByText('Router One', undefined, IMPORT_WAIT);
    expect(screen.queryByRole('region', { name: text.shareTitle })).not.toBeInTheDocument();
    expect(useFormState.getState().form).toEqual(EMPTY_FORM);
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(document.activeElement?.tagName).toBe('MAIN');
    await settle();
    expect(urls()).toEqual([`/api/share/${ID}`]);
  });

  it('leaves a share that is not found', async () => {
    openPage('/?share=nope');
    const section = await sharedSection();

    await userEvent.click(within(section).getByRole('button', { name: text.shareNewQuery }));

    await screen.findAllByText('Router One', undefined, IMPORT_WAIT);
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(fetch).not.toHaveBeenCalled();
  });
});
