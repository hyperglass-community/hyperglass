import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { HISTORY_KEY, useHistoryView, useQueryHistory, useShareLinks } from '~/hooks';
import { HistoryResults } from './history-results';
import { RecentQueries } from './recent-queries';

import type { CreatedShare, HistoryEntry } from '~/hooks';
import type { Config } from '~/types';

// Sharing a saved result from the query history (#562): S3's Share button on each result
// of an opened entry and on the row of a one-location entry, with the share's id, expiry
// and delete token kept with the entry.

const { text } = testConfig.web;
const JUNIPER_ROUTE = '__hyperglass_juniper_bgp_route__';
const QUERY_ID = `hyperglass.query.${'ab'.repeat(32)}`;
const SHARE_ID = '00112233445566778899aabbccddeeff';
const TOKEN = 'h1st0ry-d3l3t3-t0k3n_n0t-1n-th3-url-0r-l0gs-x';
const TIMESTAMP = '2026-11-20 08:00:00';
const savedAt = Date.parse('2026-11-21T10:00:00Z');

const liveShare: CreatedShare = {
  id: SHARE_ID,
  expiresAt: '2099-12-21T08:00:00Z',
  deleteToken: TOKEN,
};
const expiredShare: CreatedShare = {
  id: 'ffeeddccbbaa99887766554433221100',
  expiresAt: '2026-01-01T00:00:00Z',
  deleteToken: 'an-expired-t0k3n-that-must-go-away-from-storage',
};

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

/** A saved query of `2001:db8::/32` on Router One (Juniper), and Router Two with `two`. */
function entry(
  id = 'saved',
  { share, two = false }: { share?: CreatedShare; two?: boolean } = {},
): HistoryEntry {
  const one = { name: 'Router One', queryId: QUERY_ID, data: response(), share };
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
      router_one: share === undefined ? { ...one, share: undefined } : one,
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
  } as HistoryEntry;
}

/** Drop `share: undefined`, which JSON drops too. */
function clean(value: HistoryEntry): HistoryEntry {
  return JSON.parse(JSON.stringify(value));
}

/** Store `entries` as a page would find them in storage, and load them, as a reload does. */
async function load(entries: HistoryEntry[]): Promise<void> {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify({ state: { entries: entries.map(clean) }, version: 2 }),
  );
  await act(async () => {
    await useQueryHistory.persist.rehydrate();
  });
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
        return new Response(JSON.stringify(liveShare), { status: 201 });
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

function storedValue(): string {
  return localStorage.getItem(HISTORY_KEY) ?? '';
}

function renderOpened(cfg: Config = config()) {
  useHistoryView.setState({ openId: useQueryHistory.getState().entries[0].id });
  return renderWithProviders(<HistoryResults />, { config: cfg });
}

function renderList(cfg: Config = config()) {
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
  // A delete token is never logged.
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) {
      const text = args.map((arg: unknown) => {
        try {
          return typeof arg === 'string' ? arg : JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      });
      expect(text.join(' ')).not.toContain(TOKEN);
    }
  }
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  useShareLinks.setState({ links: {} });
  localStorage.clear();
  window.history.replaceState(null, '');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Share in an opened history entry', () => {
  it('gives each saved result a Share button when sharing is on', async () => {
    await load([entry('saved', { two: true })]);
    renderOpened();

    expect(shareButtons()).toHaveLength(2);
  });

  it('has no Share button when sharing is off', async () => {
    await load([entry('saved', { two: true })]);
    renderOpened(config({ enable: false }));

    expect(shareButtons()).toHaveLength(0);
  });

  it("has none for a result whose location's directive no longer retains results", async () => {
    await load([entry('saved', { two: true })]);
    // Only Router One's (Juniper's) directive; Router Two runs Arista's of the same name.
    renderOpened(config({ unretained: [JUNIPER_ROUTE] }));

    expect(shareButtons()).toHaveLength(1);
    const two = screen.getByRole('button', { name: /Router Two/ }).parentElement as HTMLElement;
    expect(two).toContainElement(shareButtons()[0]);
  });

  it('has none for a result saved while its enrichment was running', async () => {
    const value = entry();
    value.results.router_one.data = response({ enrichment: 'pending' });
    await load([value]);
    renderOpened();

    expect(shareButtons()).toHaveLength(0);
  });

  it('shares the saved result, by its id and time, and keeps the link with the entry', async () => {
    await load([entry()]);
    renderOpened();

    const dialog = await createLink(shareButtons()[0]);

    expect(calls).toEqual([
      {
        url: '/api/share',
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: { queryId: QUERY_ID, expiresIn: testConfig.share.timeout, timestamp: TIMESTAMP },
      },
    ]);
    const link = within(dialog).getByRole('textbox', { name: text.shareLink });
    expect(link).toHaveValue(`${window.location.origin}/?share=${SHARE_ID}`);
    // The IPv6 target is in neither the link nor the request's address.
    expect((link as HTMLInputElement).value).not.toContain('2001');
    expect(calls[0].url).not.toContain('2001');
    expect(useQueryHistory.getState().entries[0].results.router_one.share).toEqual(liveShare);
    expect(JSON.parse(storedValue()).state.entries[0].results.router_one.share).toEqual(liveShare);
    // Nowhere on the page.
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('shows the link stored with the entry again after a reload, with no request', async () => {
    await load([entry('saved', { share: liveShare })]);
    renderOpened();

    const dialog = await openPopover(shareButtons()[0]);

    expect(within(dialog).getByRole('textbox', { name: text.shareLink })).toHaveValue(
      `${window.location.origin}/?share=${SHARE_ID}`,
    );
    expect(calls).toEqual([]);
  });

  it('deletes the link from history, and forgets its token', async () => {
    await load([entry('saved', { share: liveShare })]);
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
    expect(useQueryHistory.getState().entries[0].results.router_one.share).toBeUndefined();
    expect(storedValue()).not.toContain(TOKEN);
    expect(storedValue()).not.toContain(SHARE_ID);
  });

  it('does not show an expired link, and drops it from storage', async () => {
    await load([entry('saved', { share: expiredShare })]);
    renderOpened();

    const dialog = await openPopover(shareButtons()[0]);

    expect(within(dialog).queryByRole('textbox', { name: text.shareLink })).toBeNull();
    expect(within(dialog).getByRole('button', { name: text.shareCreate })).toBeInTheDocument();
    expect(storedValue()).not.toContain(expiredShare.deleteToken);
  });

  it('says when the server no longer holds the result, with the configured text, and offers Run again', async () => {
    stubFetch(404);
    await load([entry()]);
    const cfg = config({
      overrides: { messages: { shareResultExpired: 'Gone from the cache: run it again.' } },
    });
    renderOpened(cfg);
    const dialog = await openPopover(shareButtons()[0]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.shareCreate }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Gone from the cache: run it again.',
    );
    expect(dialog).not.toHaveTextContent('SERVER TEXT');
    expect(useQueryHistory.getState().entries[0].results.router_one.share).toBeUndefined();
    // The query is never run again on its own.
    expect(calls).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: text.historyRerun }));

    expect(useHistoryView.getState().openId).toBeNull();
    expect(useHistoryView.getState().takeReuse()).toEqual(
      expect.objectContaining({ mode: 'rerun', query: entry().query }),
    );
  });

  it("keeps the link for the page when the history can't store it", async () => {
    // In this tab's memory only: deleted in another tab, or too large for storage.
    useQueryHistory.setState({ entries: [entry()] });
    localStorage.clear();
    renderOpened();

    const dialog = await createLink(shareButtons()[0]);

    expect(within(dialog).getByRole('textbox', { name: text.shareLink })).toHaveValue(
      `${window.location.origin}/?share=${SHARE_ID}`,
    );
    expect(storedValue()).not.toContain(TOKEN);
  });
});

describe('Share in Recent queries', () => {
  it('has a Share button on the row of a one-location query, none on a query of several', async () => {
    await load([entry('one'), entry('two', { two: true })]);
    renderList();

    expect(within(rows()[0]).getAllByRole('button', { name: text.shareResult })).toHaveLength(1);
    expect(within(rows()[1]).queryByRole('button', { name: text.shareResult })).toBeNull();
  });

  it('has no Share button on a row when sharing is off', async () => {
    await load([entry('one')]);
    renderList(config({ enable: false }));

    expect(within(rows()[0]).queryByRole('button', { name: text.shareResult })).toBeNull();
  });

  it('shares from a row, which then shows that it has a link', async () => {
    await load([entry('one')]);
    renderList();
    expect(rows()[0]).not.toHaveTextContent(text.historyShared);

    await createLink(within(rows()[0]).getByRole('button', { name: text.shareResult }));

    expect(rows()[0]).toHaveTextContent(text.historyShared);
    expect(JSON.parse(storedValue()).state.entries[0].results.router_one.share).toEqual(liveShare);
  });

  it('marks a row with a live link, also a query of several locations, but not one whose link expired', async () => {
    await load([
      entry('live', { share: liveShare, two: true }),
      entry('expired', { share: expiredShare }),
      entry('none'),
    ]);
    renderList();

    expect(rows()[0]).toHaveTextContent(text.historyShared);
    expect(rows()[1]).not.toHaveTextContent(text.historyShared);
    expect(rows()[2]).not.toHaveTextContent(text.historyShared);
  });

  it('drops the mark when the link expires while the list shows', async () => {
    const soon = { ...liveShare, expiresAt: new Date(Date.now() + 400).toISOString() };
    await load([entry('two', { share: soon, two: true })]);
    renderList();
    expect(rows()[0]).toHaveTextContent(text.historyShared);

    await waitFor(() => expect(rows()[0]).not.toHaveTextContent(text.historyShared), {
      timeout: 3000,
    });
    expect(storedValue()).not.toContain(TOKEN);
  });

  it('offers Run again from the row when the server no longer holds the result', async () => {
    stubFetch(404);
    await load([entry('one')]);
    renderList();
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

  it('shows a link another tab created', async () => {
    await load([entry('two', { two: true })]);
    renderList();
    expect(rows()[0]).not.toHaveTextContent(text.historyShared);

    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        state: { entries: [clean(entry('two', { share: liveShare, two: true }))] },
        version: 2,
      }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY }));
    });

    await waitFor(() => expect(rows()[0]).toHaveTextContent(text.historyShared));
  });

  describe('deleting a query with a live link', () => {
    async function pressDelete(): Promise<HTMLElement> {
      const button = within(rows()[0]).getByRole('button', { name: text.historyDelete });
      await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
      await userEvent.click(button);
      return screen.getByRole('group', { name: text.historyDeleteConfirm });
    }

    it('asks first, and says the link keeps working', async () => {
      await load([entry('two', { share: liveShare, two: true }), entry('other')]);
      renderList();

      const group = await pressDelete();

      expect(group).toHaveTextContent(text.historyShareKept);
      expect(group).toHaveAccessibleDescription(text.historyShareKept);
      expect(within(group).getByRole('button', { name: text.historyClearCancel })).toHaveFocus();
      expect(useQueryHistory.getState().entries).toHaveLength(2);
    });

    it.each([
      [
        'Cancel',
        async (group: HTMLElement) =>
          userEvent.click(within(group).getByRole('button', { name: text.historyClearCancel })),
      ],
      ['Escape', async () => userEvent.keyboard('{Escape}')],
    ])('keeps it with %s', async (_, cancel) => {
      await load([entry('two', { share: liveShare, two: true })]);
      renderList();

      await cancel(await pressDelete());

      expect(screen.queryByRole('group', { name: text.historyDeleteConfirm })).toBeNull();
      expect(rows()).toHaveLength(1);
      expect(within(rows()[0]).getByRole('button', { name: text.historyDelete })).toHaveFocus();
      expect(storedValue()).toContain(TOKEN);
    });

    it('deletes it once confirmed, with its token, and leaves the link on the server', async () => {
      await load([entry('two', { share: liveShare, two: true }), entry('other')]);
      renderList();
      const group = await pressDelete();

      await userEvent.click(within(group).getByRole('button', { name: text.historyDelete }));

      expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['other']);
      expect(storedValue()).not.toContain(TOKEN);
      expect(calls).toEqual([]);
      expect(screen.getByRole('heading', { name: text.historyTitle })).toHaveFocus();
    });

    it('deletes a query whose link expired at once', async () => {
      await load([entry('expired', { share: expiredShare, two: true }), entry('other')]);
      renderList();
      const button = within(rows()[0]).getByRole('button', { name: text.historyDelete });
      await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);

      await userEvent.click(button);

      expect(screen.queryByRole('group', { name: text.historyDeleteConfirm })).toBeNull();
      expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['other']);
    });
  });

  describe('clear all', () => {
    async function pressClearAll(): Promise<HTMLElement> {
      await userEvent.click(screen.getByRole('button', { name: text.historyClearAll }));
      return screen.getByRole('group', { name: text.historyClearConfirm });
    }

    it('says links keep working when a query has one', async () => {
      await load([entry('none'), entry('live', { share: liveShare })]);
      renderList();

      const group = await pressClearAll();

      expect(group).toHaveTextContent(text.historyShareKept);
      expect(group).toHaveAccessibleDescription(text.historyShareKept);
    });

    it('says nothing about links when no query has a live one', async () => {
      await load([entry('none'), entry('expired', { share: expiredShare })]);
      renderList();

      const group = await pressClearAll();

      expect(group).not.toHaveTextContent(text.historyShareKept);
    });

    it('forgets every token, and leaves the links on the server', async () => {
      await load([entry('live', { share: liveShare })]);
      renderList();
      const group = await pressClearAll();

      await userEvent.click(within(group).getByRole('button', { name: text.historyClearAll }));

      expect(storedValue()).not.toContain(TOKEN);
      expect(calls).toEqual([]);
    });
  });

  it('uses the configured text', async () => {
    await load([entry('live', { share: liveShare })]);
    renderList(
      config({
        overrides: {
          web: {
            text: {
              historyShared: 'Has a link',
              historyDeleteConfirm: 'Really delete?',
              historyShareKept: 'The link stays.',
            },
          },
        },
      }),
    );

    expect(rows()[0]).toHaveTextContent('Has a link');
    const button = within(rows()[0]).getByRole('button', { name: text.historyDelete });
    await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
    await userEvent.click(button);
    const group = screen.getByRole('group', { name: 'Really delete?' });
    expect(group).toHaveTextContent('The link stays.');
  });
});
