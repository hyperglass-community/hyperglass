import { Accordion } from '@chakra-ui/react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { HistoryResults } from '~/components/history/history-results';
import { Result } from '~/components/results/individual';
import { SHARES_KEY, useFormState, useHistoryView, useQueryHistory, useSavedShares } from '~/hooks';
import { SavedShares } from './saved-shares';

import type { HistoryEntry, SavedShare } from '~/hooks';
import type { Config } from '~/types';

// `share.remember_links: false` (#562), for kiosks and shared terminals: share links and
// their delete tokens stay in the page's memory, nothing is written to the browser's
// storage, and what it stored before is deleted when the page loads.

const { text } = testConfig.web;
const initialFormState = useFormState.getState();
const JUNIPER_ROUTE = '__hyperglass_juniper_bgp_route__';
const QUERY_ID = `hyperglass.query.${'ef'.repeat(32)}`;
const SHARE_ID = '00112233445566778899aabbccddeeff';
const TOKEN = 'k10sk-t0k3n_n0t-1n-st0r4g3-0r-th3-url-xyz123';
const TIMESTAMP = '2026-11-23 08:00:00';

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: QUERY_ID,
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: TIMESTAMP,
    keywords: [],
    output: 'show route 2001:db8::/32',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

function saved(overrides: Partial<SavedShare> = {}): SavedShare {
  return {
    id: SHARE_ID,
    queryId: QUERY_ID,
    timestamp: TIMESTAMP,
    expiresAt: '2099-12-23T08:00:00Z',
    deadline: Date.now() + 86_400_000,
    deleteToken: TOKEN,
    savedAt: Date.now(),
    labels: { location: 'Router One', type: 'BGP Route', target: '2001:db8::/32' },
    ...overrides,
  };
}

function config(remember: boolean): Config {
  return makeConfig({ share: { enable: true, rememberLinks: remember } });
}

/** `/api/query` answers a result, `POST /api/share` creates a share, `DELETE` 204 or 404. */
function stubFetch({ rotated = false } = {}) {
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/share' && init.method === 'POST') {
      return new Response(
        JSON.stringify({ id: SHARE_ID, expiresAt: '2099-12-23T08:00:00Z', deleteToken: TOKEN }),
        { status: 201 },
      );
    }
    if (url.startsWith('/api/share/') && init.method === 'DELETE') {
      return new Response(rotated ? '' : null, { status: rotated ? 404 : 204 });
    }
    if (url.startsWith('/api/share/')) {
      return new Response('{}', { status: 200 });
    }
    return { ok: true, json: async () => response(), statusText: 'OK' } as Response;
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

/** Everything the browser's storage holds. */
function storage(): string {
  return [...Object.keys(localStorage), ...Object.values(localStorage)].join(' ');
}

let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  localStorage.clear();
  setItem = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useSavedShares.getState().clear();
  useSavedShares.getState().configure(true);
  useFormState.setState(initialFormState, true);
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  localStorage.clear();
});

/** No call wrote share links to storage. */
function expectNothingStored(): void {
  expect(setItem.mock.calls.filter(([key]: unknown[]) => key === SHARES_KEY)).toEqual([]);
  expect(localStorage.getItem(SHARES_KEY)).toBeNull();
  expect(storage()).not.toContain(TOKEN);
}

async function renderLive(cfg: Config): Promise<void> {
  useFormState.setState(
    {
      ...initialFormState,
      form: {
        queryLocation: ['router_one'],
        queryTarget: ['2001:db8::/32'],
        queryType: JUNIPER_ROUTE,
        queryVariables: {},
      },
      status: 'results',
    },
    true,
  );
  renderWithProviders(
    <Accordion allowMultiple>
      <Result index={0} queryLocation="router_one" />
    </Accordion>,
    { config: cfg },
  );
  const button = await screen.findByRole('button', { name: text.shareResult }, IMPORT_WAIT);
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
}

async function createLink(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: text.shareResult }));
  const dialog = await screen.findByRole('dialog', { name: text.shareResult });
  await userEvent.click(within(dialog).getByRole('button', { name: text.shareCreate }));
  await within(dialog).findByRole('textbox', { name: text.shareLink });
  return dialog;
}

describe('remember_links off', () => {
  it('keeps a live result’s link in the page, says so, and stores nothing', async () => {
    stubFetch();
    await renderLive(config(false));

    const dialog = await createLink();

    expect(within(dialog).getByRole('textbox', { name: text.shareLink })).toHaveValue(
      `${window.location.origin}/?share=${SHARE_ID}`,
    );
    expect(dialog).toHaveTextContent(text.shareDeleteScopePage);
    expect(useSavedShares.getState().links.map(l => l.id)).toEqual([SHARE_ID]);
    expectNothingStored();
  });

  it('deletes the link from the page, and stores nothing', async () => {
    const fetch = stubFetch();
    await renderLive(config(false));
    const dialog = await createLink();

    await userEvent.click(within(dialog).getByRole('button', { name: text.shareDelete }));

    await within(dialog).findByText(text.shareDeleted);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    expect(useSavedShares.getState().links).toEqual([]);
    expectNothingStored();
  });

  it('shares a saved result from the history, and stores nothing', async () => {
    stubFetch();
    const entry: HistoryEntry = {
      id: 'saved',
      savedAt: Date.now(),
      query: {
        queryLocation: ['router_one'],
        queryType: JUNIPER_ROUTE,
        queryTypeName: 'BGP Route',
        queryTarget: ['2001:db8::/32'],
        queryVariables: {},
      },
      labels: {
        locations: ['Router One'],
        type: 'BGP Route',
        target: '2001:db8::/32',
        variables: [],
      },
      results: { router_one: { name: 'Router One', queryId: QUERY_ID, data: response() } },
    };
    useQueryHistory.setState({ entries: [entry] });
    useHistoryView.setState({ openId: 'saved' });
    setItem.mockClear();
    renderWithProviders(<HistoryResults />, { config: config(false) });
    const button = screen.getByRole('button', { name: text.shareResult });
    await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);

    await createLink();

    expect(useSavedShares.getState().links.map(l => l.id)).toEqual([SHARE_ID]);
    expectNothingStored();
  });

  it('lists this page’s links, and keeps a replaced token’s link without storing it', async () => {
    stubFetch({ rotated: true });
    renderWithProviders(
      <main>
        <SavedShares />
      </main>,
      { config: config(false) },
    );
    act(() => useSavedShares.getState().add(saved()));

    const list = await screen.findByRole('region', { name: text.sharesTitle });
    await userEvent.click(within(list).getByRole('button', { name: text.shareDelete }));

    await within(list).findByText(text.shareDeleteRotated);
    expect(useSavedShares.getState().links[0].deleteToken).toBeNull();
    expectNothingStored();
  });

  it('deletes what the browser stored before when the page loads', async () => {
    localStorage.setItem(SHARES_KEY, JSON.stringify({ version: 1, links: [saved()] }));
    useSavedShares.setState({ links: [saved()] });

    renderWithProviders(
      <main>
        <SavedShares />
      </main>,
      { config: config(false) },
    );

    await waitFor(() => expect(localStorage.getItem(SHARES_KEY)).toBeNull());
    expect(useSavedShares.getState().links).toEqual([]);
    expect(screen.queryByRole('region', { name: text.sharesTitle })).toBeNull();
  });
});

describe('remember_links on', () => {
  it('keeps a live result’s link in the browser’s storage, as before', async () => {
    stubFetch();
    await renderLive(config(true));

    const dialog = await createLink();

    expect(dialog).toHaveTextContent(text.shareDeleteScope.replace('{shares}', text.sharesTitle));
    expect(localStorage.getItem(SHARES_KEY)).toContain(SHARE_ID);
  });

  it('keeps what the browser stored when the page loads', async () => {
    localStorage.setItem(SHARES_KEY, JSON.stringify({ version: 1, links: [saved()] }));
    useSavedShares.setState({ links: [saved()] });

    renderWithProviders(
      <main>
        <SavedShares />
      </main>,
      { config: config(true) },
    );

    expect(await screen.findByRole('region', { name: text.sharesTitle })).toBeInTheDocument();
    expect(localStorage.getItem(SHARES_KEY)).toContain(SHARE_ID);
  });
});
