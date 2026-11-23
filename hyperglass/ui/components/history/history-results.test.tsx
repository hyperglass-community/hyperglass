import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { useFormState, useHistoryView, useQueryHistory } from '~/hooks';
import { formatTimestamp } from '~/util';
import { HistoryResults } from './history-results';

import type { HistoryEntry } from '~/hooks';
import type { Config } from '~/types';

// The chart needs a layout engine that jsdom lacks; the modal around it is what matters here.
vi.mock('~/components/path/chart', () => ({ Chart: () => null }));

const { text } = testConfig.web;
const initialFormState = useFormState.getState();
const savedAt = Date.parse('2026-11-21T10:00:00Z');

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: 'c0ffee',
    random: 'r4nd0m',
    // A saved response may have come from the cache; it is shown with its saved time.
    cached: true,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-20 08:00:00',
    keywords: [],
    output: 'show route 2001:db8::/32\n2001:db8::/32 *[BGP/170] via 2001:db8:ffff::1',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

const bgpOutput: StructuredResponse = {
  vrf: 'default',
  count: 1,
  routes: [
    {
      prefix: '2001:db8::/32',
      active: true,
      age: 3600,
      weight: 170,
      med: 0,
      local_preference: 100,
      as_path: [65001, 64496],
      communities: ['65001:100'],
      next_hop: '2001:db8:ffff::1',
      source_as: 64496,
      source_rid: '198.51.100.1',
      peer_rid: '198.51.100.1',
      rpki_state: 1,
      filtered: false,
    },
  ],
  winning_weight: 'low',
  asn_organizations: {},
};

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'saved',
    savedAt,
    query: {
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTypeName: 'BGP Route',
      queryTarget: ['2001:db8::/32'],
      queryVariables: { vrf: 'blue' },
    },
    labels: {
      locations: ['Router One', 'Router Two'],
      type: 'BGP Route',
      target: '2001:db8::/32',
      variables: ['VRF: Blue VRF'],
    },
    results: {
      // Saved in the order the responses arrived.
      router_two: {
        name: 'Router Two (old name)',
        queryId: 'two',
        data: response({ id: 'two', output: 'output of router two' }),
      },
      router_one: { name: 'Router One', queryId: 'c0ffee', data: response() },
    },
    ...overrides,
  };
}

function renderOpened(value: HistoryEntry = entry(), config?: Config) {
  useQueryHistory.setState({ entries: [value] });
  useHistoryView.setState({ openId: value.id });
  return renderWithProviders(<HistoryResults />, { config });
}

function headers(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /^Router/ });
}

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // framer-motion and the results view scroll with `window.scrollTo`, which jsdom lacks.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  fetch = vi.fn(async () => Promise.reject(new Error('no request expected')));
  vi.stubGlobal('fetch', fetch);
  window.history.replaceState(null, '');
});

afterEach(() => {
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null });
  useFormState.setState(initialFormState, true);
  localStorage.clear();
  window.history.replaceState(null, '');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HistoryResults', () => {
  it('shows the saved results expanded, in the order the locations were queried, with no request', async () => {
    const { container } = renderOpened();

    for (const header of headers()) {
      expect(header).toHaveAttribute('aria-expanded', 'true');
    }
    expect(headers().map(h => h.textContent)).toEqual([
      expect.stringContaining('Router One'),
      expect.stringContaining('Router Two (old name)'),
    ]);
    const outputs = Array.from(container.querySelectorAll('pre'), pre => pre.textContent);
    expect(outputs).toEqual([
      expect.stringContaining('2001:db8::/32 *[BGP/170] via 2001:db8:ffff::1'),
      expect.stringContaining('output of router two'),
    ]);
    expect(fetch).not.toHaveBeenCalled();
    // Nothing goes to the form state either.
    expect(useFormState.getState().responses).toEqual({});
  });

  it('shows the query type, the IPv6 target, the variables and when it was saved', () => {
    renderOpened();

    expect(screen.getByText('BGP Route')).toBeInTheDocument();
    expect(screen.getByText('2001:db8::/32')).toBeInTheDocument();
    expect(screen.getByText('VRF: Blue VRF')).toBeInTheDocument();
    expect(
      screen.getByText(`Saved ${formatTimestamp(new Date(savedAt).toISOString())}`),
    ).toBeInTheDocument();
  });

  it('offers copy but no requery, and no cache countdown', async () => {
    renderOpened();

    expect(screen.getAllByRole('button', { name: text.copyOutput })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: text.reloadQuery })).not.toBeInTheDocument();
    expect(screen.queryByText(text.cachePrefix.trim(), { exact: false })).not.toBeInTheDocument();
  });

  it('opens the AS path of a saved BGP table with no request', async () => {
    const bgp = entry({
      results: {
        router_one: {
          name: 'Router One',
          queryId: 'c0ffee',
          data: response({ format: 'application/json', output: bgpOutput }),
        },
      },
    });
    renderOpened(bgp, makeConfig({ web: { aspathEnrichment: true } }));

    await userEvent.click(
      await screen.findByRole('button', { name: text.viewAsPath }, IMPORT_WAIT),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Path to 2001:db8::/32' }, IMPORT_WAIT),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('moves focus to its Back button', () => {
    renderOpened();

    expect(screen.getByRole('button', { name: text.historyBack })).toHaveFocus();
  });

  it('closes when Back is pressed', async () => {
    renderOpened();

    await userEvent.click(screen.getByRole('button', { name: text.historyBack }));

    expect(useHistoryView.getState().openId).toBeNull();
  });

  it('goes back through browser history when the opened entry has its own', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    window.history.replaceState({ ultraglass: 'history' }, '');
    renderOpened();

    await userEvent.click(screen.getByRole('button', { name: text.historyBack }));

    expect(back).toHaveBeenCalledTimes(1);
    // The popstate event that follows closes it (see `Layout`).
    expect(useHistoryView.getState().openId).toBe('saved');
  });

  it('closes when the opened entry no longer exists, as when another tab deleted it', () => {
    renderOpened();

    act(() => {
      useQueryHistory.setState({ entries: [] });
    });

    expect(screen.queryByRole('button', { name: text.historyBack })).not.toBeInTheDocument();
    expect(useHistoryView.getState().openId).toBeNull();
  });

  it('goes back through browser history when the opened entry is gone and has its own entry', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    window.history.replaceState({ ultraglass: 'history' }, '');
    renderOpened();

    act(() => {
      useQueryHistory.setState({ entries: [] });
    });

    expect(back).toHaveBeenCalledTimes(1);
    // The popstate event that follows closes it (see `Layout`).
    expect(useHistoryView.getState().openId).toBe('saved');
  });

  it('uses the configured text', () => {
    renderOpened(
      entry(),
      makeConfig({
        web: { text: { historyBack: 'Retour', historySavedAt: 'Enregistrée {time}' } },
      }),
    );

    expect(screen.getByRole('button', { name: 'Retour' })).toBeInTheDocument();
    const saved = screen.getByText(/^Enregistrée /);
    expect(within(saved).queryByText('Saved', { exact: false })).not.toBeInTheDocument();
  });
});
