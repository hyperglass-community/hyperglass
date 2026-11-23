import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { SHARES_KEY, useHistoryView, useQueryHistory, useSavedShares } from '~/hooks';
import { formatTimestamp } from '~/util';
import { HistoryResults } from './history-results';
import { RecentQueries } from './recent-queries';

import type { HistoryEntry, SavedShare } from '~/hooks';
import type { Config } from '~/types';

// Sharing a saved result from the query history (#562): S3's Share button on each result
// of an opened entry and on the row of a one-location entry. The links go to this
// browser's store of shared links (`hyperglass.shares`), not into the history.

const { text } = testConfig.web;
const JUNIPER_ROUTE = '__hyperglass_juniper_bgp_route__';
const QUERY_ID = `hyperglass.query.${'ab'.repeat(32)}`;
const SHARE_ID = '00112233445566778899aabbccddeeff';
const TOKEN = 'h1st0ry-d3l3t3-t0k3n_n0t-1n-th3-url-0r-l0gs-x';
const TIMESTAMP = '2026-11-20 08:00:00';
const savedAt = Date.parse('2026-11-21T10:00:00Z');

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: QUERY_ID,
    random: 'r4nd0m',
    cached: true,
    runtime: 2,
    level: 'success',
    timestamp: TIMESTAMP,
    keywords: [],
    output: 'show route 2001:db8::/32\n2001:db8::/32 *[BGP/170] via 2001:db8:ffff::1',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

/** A saved query of `2001:db8::/32` on Router One (Juniper), and on Router Two with `two`. */
function entry(id = 'saved', { two = false } = {}): HistoryEntry {
  return {
    id,
    savedAt,
    query: {
      queryLocation: two ? ['router_one', 'router_two'] : ['router_one'],
      queryType: JUNIPER_ROUTE,
      queryTypeName: 'BGP Route',
      queryTarget: ['2001:db8::/32'],
      queryVariables: {},
    },
    labels: {
      locations: two ? ['Router One', 'Router Two'] : ['Router One'],
      type: 'BGP Route',
      target: '2001:db8::/32',
      variables: [],
    },
    results: {
      router_one: { name: 'Router One', queryId: QUERY_ID, data: response() },
      ...(two
        ? {
            router_two: {
              name: 'Router Two',
              queryId: 'two',
              data: response({ id: 'two', output: 'output of router two' }),
            },
          }
        : {}),
    },
  };
}

/** A link saved in this browser for the saved result of Router One. */
function saved(overrides: Partial<SavedShare> = {}): SavedShare {
  return {
    id: SHARE_ID,
    queryId: QUERY_ID,
    timestamp: TIMESTAMP,
    expiresAt: '2099-12-21T08:00:00Z',
    deadline: Date.now() + 30 * 86_400_000,
    deleteToken: TOKEN,
    savedAt: Date.now(),
    labels: { location: 'Router One', type: 'BGP Route', target: '2001:db8::/32' },
    ...overrides,
  };
}

/** Sharing on, and optionally `retain: false` on the directives `unretained`. */
function config({
  enable = true,
  unretained = [] as string[],
  overrides = {} as Parameters<typeof makeConfig>[0],
} = {}): Config {
  const result = makeConfig({ share: { enable }, ...overrides });
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

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];

/** `POST /api/share` answers `createStatus`; `DELETE` answers 204. */
function stubFetch(createStatus = 201): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      calls.push({ url, method: init.method ?? 'GET', headers, body });
      if (url === '/api/share' && init.method === 'POST') {
        if (createStatus !== 201) {
          return new Response('SERVER TEXT', { status: createStatus });
        }
        return new Response(
          JSON.stringify({ id: SHARE_ID, expiresAt: '2099-12-21T08:00:00Z', deleteToken: TOKEN }),
          { status: 201 },
        );
      }
      if (url.startsWith('/api/share/') && init.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request ${url}`);
    }),
  );
}

const shareButtons = (): HTMLElement[] =>
  screen.queryAllByRole('button', { name: text.shareResult });

async function openPopover(button: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  await userEvent.click(button);
  return screen.findByRole('dialog', { name: text.shareResult });
}

async function createLink(button: HTMLElement): Promise<HTMLElement> {
  const dialog = await openPopover(button);
  await userEvent.click(within(dialog).getByRole('button', { name: text.shareCreate }));
  await within(dialog).findByRole('textbox', { name: text.shareLink });
  return dialog;
}

function storedShares(): string {
  return localStorage.getItem(SHARES_KEY) ?? '';
}

function renderOpened(cfg: Config = config(), value: HistoryEntry = entry()) {
  useQueryHistory.setState({ entries: [value] });
  useHistoryView.setState({ openId: value.id });
  return renderWithProviders(<HistoryResults />, { config: cfg });
}

function renderList(entries: HistoryEntry[], cfg: Config = config()) {
  useQueryHistory.setState({ entries });
  return renderWithProviders(<RecentQueries />, { config: cfg });
}

function rows(): HTMLElement[] {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
    vi.spyOn(console, level),
  );
  localStorage.clear();
  stubFetch();
});

afterEach(() => {
  // A delete token is never logged, not even inside a logged object.
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) {
      const logged = args.map((arg: unknown) => {
        try {
          return typeof arg === 'string' ? arg : JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      });
      expect(logged.join(' ')).not.toContain(TOKEN);
    }
  }
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useSavedShares.getState().clear();
  localStorage.clear();
  window.history.replaceState(null, '');
});

describe('Share in an opened history entry', () => {
  it('gives each saved result a Share button when sharing is on', () => {
    renderOpened(config(), entry('saved', { two: true }));

    expect(shareButtons()).toHaveLength(2);
  });

  it('has no Share button when sharing is off', () => {
    renderOpened(config({ enable: false }), entry('saved', { two: true }));

    expect(shareButtons()).toHaveLength(0);
  });

  it("has none for a result whose location's directive no longer retains results", () => {
    // Only Router One's (Juniper's) directive; Router Two runs Arista's of the same name.
    renderOpened(config({ unretained: [JUNIPER_ROUTE] }), entry('saved', { two: true }));

    expect(shareButtons()).toHaveLength(1);
    const two = screen.getByRole('button', { name: /Router Two/ }).parentElement as HTMLElement;
    expect(two).toContainElement(shareButtons()[0]);
  });

  it('has none for a result saved while its enrichment was running', () => {
    const value = entry();
    value.results.router_one.data = response({ enrichment: 'pending' });
    renderOpened(config(), value);

    expect(shareButtons()).toHaveLength(0);
  });

  it("shares the saved result by its id and time, and saves the link in this browser's store", async () => {
    renderOpened();

    const dialog = await createLink(shareButtons()[0]);

    expect(calls).toEqual([
      {
        url: '/api/share',
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: { queryId: QUERY_ID, timestamp: TIMESTAMP, expiresIn: testConfig.share.timeout },
      },
    ]);
    const link = within(dialog).getByRole('textbox', { name: text.shareLink });
    expect(link).toHaveValue(`${window.location.origin}/?share=${SHARE_ID}`);
    // The IPv6 target is in neither the link nor the request's address.
    expect((link as HTMLInputElement).value).not.toContain('2001');
    expect(calls[0].url).not.toContain('2001');
    expect(useSavedShares.getState().links).toEqual([
      expect.objectContaining({
        id: SHARE_ID,
        queryId: QUERY_ID,
        timestamp: TIMESTAMP,
        deleteToken: TOKEN,
        labels: { location: 'Router One', type: 'BGP Route', target: '2001:db8::/32' },
      }),
    ]);
    expect(storedShares()).toContain(SHARE_ID);
    // Nothing about the link goes into the history, and the token isn't on the page.
    expect(JSON.stringify(useQueryHistory.getState().entries)).not.toContain(SHARE_ID);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('shows a link saved in this browser again, as after a reload, with no request', async () => {
    useSavedShares.getState().add(saved());
    renderOpened();

    const dialog = await openPopover(shareButtons()[0]);

    expect(within(dialog).getByRole('textbox', { name: text.shareLink })).toHaveValue(
      `${window.location.origin}/?share=${SHARE_ID}`,
    );
    expect(calls).toEqual([]);
  });

  it('lists a link of an earlier result of the same query as an earlier link', async () => {
    useSavedShares.getState().add(saved({ timestamp: '2026-11-19 08:00:00' }));
    renderOpened();

    const dialog = await openPopover(shareButtons()[0]);

    expect(
      within(dialog).getByRole('textbox', {
        name: `Link to the result from ${formatTimestamp('2026-11-19 08:00:00')}`,
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: text.shareCreate })).toBeInTheDocument();
  });

  it('deletes the link, and forgets its token', async () => {
    useSavedShares.getState().add(saved());
    renderOpened();
    const dialog = await openPopover(shareButtons()[0]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.shareDelete }));

    await within(dialog).findByText(text.shareDeleted);
    expect(calls).toEqual([
      {
        url: `/api/share/${SHARE_ID}`,
        method: 'DELETE',
        headers: { 'x-delete-token': TOKEN },
        body: undefined,
      },
    ]);
    expect(useSavedShares.getState().links).toEqual([]);
    expect(storedShares()).not.toContain(TOKEN);
  });

  it('does not show an expired link, and drops it from storage', async () => {
    useSavedShares.getState().add(saved({ deadline: Date.now() + 200 }));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    renderOpened();

    const dialog = await openPopover(shareButtons()[0]);

    expect(within(dialog).queryByRole('textbox', { name: text.shareLink })).toBeNull();
    expect(within(dialog).getByRole('button', { name: text.shareCreate })).toBeInTheDocument();
    await waitFor(() => expect(storedShares()).not.toContain(TOKEN));
  });

  it('says when the server no longer holds the result, with the configured text, and offers Run again', async () => {
    stubFetch(404);
    renderOpened(
      config({
        overrides: { messages: { shareResultExpired: 'Gone from the cache: run it again.' } },
      }),
    );
    const dialog = await openPopover(shareButtons()[0]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.shareCreate }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Gone from the cache: run it again.',
    );
    expect(dialog).not.toHaveTextContent('SERVER TEXT');
    expect(useSavedShares.getState().links).toEqual([]);
    // The query is never run again on its own.
    expect(calls).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: text.historyRerun }));

    expect(useHistoryView.getState().openId).toBeNull();
    expect(useHistoryView.getState().takeReuse()).toEqual(
      expect.objectContaining({ mode: 'rerun', query: entry().query }),
    );
  });

  it('keeps working with history turned off: the links do not depend on it', async () => {
    renderOpened(config({ overrides: { web: { history: { enable: false } } } }));

    await createLink(shareButtons()[0]);

    expect(useSavedShares.getState().links.map(l => l.id)).toEqual([SHARE_ID]);
  });
});

describe('Share in Recent queries', () => {
  it('has a Share button on the row of a one-location query, none on a query of several', () => {
    renderList([entry('one'), entry('two', { two: true })]);

    expect(within(rows()[0]).getAllByRole('button', { name: text.shareResult })).toHaveLength(1);
    expect(within(rows()[1]).queryByRole('button', { name: text.shareResult })).toBeNull();
  });

  it('has no Share button on a row when sharing is off', () => {
    renderList([entry('one')], config({ enable: false }));

    expect(within(rows()[0]).queryByRole('button', { name: text.shareResult })).toBeNull();
  });

  it('shares from a row, which then shows that it has a link', async () => {
    renderList([entry('one')]);
    expect(rows()[0]).not.toHaveTextContent(text.historyShared);

    await createLink(within(rows()[0]).getByRole('button', { name: text.shareResult }));

    expect(rows()[0]).toHaveTextContent(text.historyShared);
    expect(useSavedShares.getState().links.map(l => l.id)).toEqual([SHARE_ID]);
  });

  it("marks a row whose result has a live link, not one with only an earlier result's link", () => {
    useSavedShares.getState().add(saved());
    useSavedShares
      .getState()
      .add(saved({ id: 'b'.repeat(32), queryId: 'two', timestamp: '2026-11-19 08:00:00' }));
    const other = entry('other', { two: true });
    other.results.router_one = {
      name: 'Router One',
      queryId: 'elsewhere',
      data: response({ id: 'elsewhere' }),
    };
    renderList([entry('live', { two: true }), other]);

    expect(rows()[0]).toHaveTextContent(text.historyShared);
    expect(rows()[1]).not.toHaveTextContent(text.historyShared);
  });

  it('drops the mark when the link expires while the list shows', async () => {
    useSavedShares.getState().add(saved({ deadline: Date.now() + 400 }));
    renderList([entry('two', { two: true })]);
    expect(rows()[0]).toHaveTextContent(text.historyShared);

    await waitFor(() => expect(rows()[0]).not.toHaveTextContent(text.historyShared), {
      timeout: 3000,
    });
    expect(storedShares()).not.toContain(TOKEN);
  });

  it('offers Run again from the row when the server no longer holds the result', async () => {
    stubFetch(404);
    renderList([entry('one')]);
    const dialog = await openPopover(
      within(rows()[0]).getByRole('button', { name: text.shareResult }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: text.shareCreate }));
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: text.historyRerun }));

    expect(useHistoryView.getState().takeReuse()).toEqual(
      expect.objectContaining({ mode: 'rerun', query: entry('one').query }),
    );
  });

  it('marks a row when another tab saves a link to its result', async () => {
    renderList([entry('two', { two: true })]);
    expect(rows()[0]).not.toHaveTextContent(text.historyShared);

    localStorage.setItem(SHARES_KEY, JSON.stringify({ version: 1, links: [saved()] }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SHARES_KEY }));
    });

    await waitFor(() => expect(rows()[0]).toHaveTextContent(text.historyShared));
  });

  it('deletes a query with a link at once, and keeps the link in this browser', async () => {
    useSavedShares.getState().add(saved());
    renderList([entry('two', { two: true }), entry('other')]);
    const button = within(rows()[0]).getByRole('button', { name: text.historyDelete });
    await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);

    await userEvent.click(button);

    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['other']);
    expect(useSavedShares.getState().links.map(l => l.id)).toEqual([SHARE_ID]);
    expect(storedShares()).toContain(TOKEN);
    expect(calls).toEqual([]);
  });

  describe('clear all', () => {
    async function pressClearAll(): Promise<HTMLElement> {
      await userEvent.click(screen.getByRole('button', { name: text.historyClearAll }));
      return screen.getByRole('group', { name: text.historyClearConfirm });
    }

    it('says the links stay when a query has one', async () => {
      useSavedShares.getState().add(saved());
      renderList([entry('none', { two: true }), entry('live')]);

      const group = await pressClearAll();

      expect(group).toHaveTextContent(text.historyShareKept);
      expect(group).toHaveAccessibleDescription(text.historyShareKept);
    });

    it('says nothing about links when no query has one', async () => {
      useSavedShares.getState().add(saved({ queryId: 'elsewhere' }));
      renderList([entry('none')]);

      const group = await pressClearAll();

      expect(group).not.toHaveTextContent(text.historyShareKept);
    });

    it('keeps every link in this browser, and makes no request', async () => {
      useSavedShares.getState().add(saved());
      renderList([entry('live')]);
      const group = await pressClearAll();

      await userEvent.click(within(group).getByRole('button', { name: text.historyClearAll }));

      expect(useQueryHistory.getState().entries).toEqual([]);
      expect(useSavedShares.getState().links.map(l => l.id)).toEqual([SHARE_ID]);
      expect(calls).toEqual([]);
    });
  });

  it('uses the configured text', async () => {
    useSavedShares.getState().add(saved());
    renderList(
      [entry('live')],
      config({
        overrides: { web: { text: { historyShared: 'Has a link', historyShareKept: 'Kept.' } } },
      }),
    );

    expect(rows()[0]).toHaveTextContent('Has a link');
    await userEvent.click(screen.getByRole('button', { name: text.historyClearAll }));
    expect(screen.getByRole('group', { name: text.historyClearConfirm })).toHaveTextContent(
      'Kept.',
    );
  });
});
