import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { HISTORY_KEY, useQueryHistory } from '~/hooks';
import { formatTimestamp } from '~/util';
import { RecentQueries } from './recent-queries';

import type { HistoryEntry } from '~/hooks';
import type { Config } from '~/types';

const { text } = testConfig.web;

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: 'c0ffee',
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-20 08:00:00',
    keywords: [],
    output: 'show route',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

const savedAt = Date.parse('2026-11-21T10:00:00Z');

function entry(id: string, target: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    savedAt,
    query: {
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTypeName: 'BGP Route',
      queryTarget: [target],
      queryVariables: {},
    },
    labels: {
      locations: ['Router One', 'Router Two'],
      type: 'BGP Route',
      target,
      variables: [],
    },
    results: { router_one: { name: 'Router One', queryId: id, data: response({ id }) } },
    ...overrides,
  };
}

const ipv6 = entry('v6', '2001:db8::/32', {
  labels: {
    locations: ['Router One', 'Router Two'],
    type: 'BGP Route',
    target: '2001:db8::/32',
    variables: ['VRF: Blue VRF'],
  },
});
const ipv4 = entry('v4', '192.0.2.0/24');

function seed(entries: HistoryEntry[]): void {
  useQueryHistory.setState({ entries, openId: null });
}

function renderList(config?: Config) {
  return renderWithProviders(<RecentQueries />, { config });
}

function rows(): HTMLElement[] {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

/** The row's buttons, once their icons have loaded. */
async function rowButton(row: HTMLElement, name: string): Promise<HTMLElement> {
  const button = within(row).getByRole('button', { name });
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  return button;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  useQueryHistory.setState({ entries: [], openId: null });
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('RecentQueries', () => {
  it('lists the saved queries, newest first, under its heading', () => {
    seed([ipv6, ipv4]);
    renderList();

    const section = screen.getByRole('region', { name: text.historyTitle });
    expect(within(section).getByRole('heading', { name: text.historyTitle })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent('2001:db8::/32');
    expect(rows()[1]).toHaveTextContent('192.0.2.0/24');
  });

  it("shows each query's labels and when it was saved", () => {
    seed([ipv6]);
    renderList();

    const [row] = rows();
    expect(row).toHaveTextContent('BGP Route');
    expect(row).toHaveTextContent('2001:db8::/32');
    expect(row).toHaveTextContent('Router One, Router Two');
    expect(row).toHaveTextContent('VRF: Blue VRF');
    expect(row).toHaveTextContent(`Saved ${formatTimestamp(new Date(savedAt).toISOString())}`);
  });

  it("names each row's buttons after its query, since every row has the same button names", () => {
    seed([ipv6, ipv4]);
    renderList();

    const group = screen.getByRole('group', { name: /2001:db8::\/32/ });
    expect(rows()[0]).toContainElement(group);
    expect(within(group).getByRole('button', { name: text.historyOpen })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: text.historyDelete })).toBeInTheDocument();
  });

  it.each([
    ['no saved query', [], makeConfig()],
    ['history disabled', [ipv4], makeConfig({ web: { history: { enable: false } } })],
  ])('shows nothing with %s', (_, entries, config) => {
    seed(entries);
    renderList(config);

    expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
  });

  it('deletes the saved history when history is disabled', () => {
    seed([ipv4]);
    expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull();

    renderList(makeConfig({ web: { history: { enable: false } } }));

    expect(useQueryHistory.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('drops the entries beyond a lowered limit', () => {
    seed([ipv6, ipv4]);

    renderList(makeConfig({ web: { history: { limit: 1 } } }));

    expect(rows()).toHaveLength(1);
    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['v6']);
  });

  it('opens a query', async () => {
    seed([ipv6, ipv4]);
    renderList();

    await userEvent.click(await rowButton(rows()[1], text.historyOpen));

    expect(useQueryHistory.getState().openId).toBe('v4');
  });

  it('deletes a query and keeps focus in the list', async () => {
    seed([ipv6, ipv4]);
    renderList();

    await userEvent.click(await rowButton(rows()[0], text.historyDelete));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('192.0.2.0/24');
    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['v4']);
    expect(screen.getByRole('heading', { name: text.historyTitle })).toHaveFocus();
  });

  it('shows nothing once the last query is deleted', async () => {
    seed([ipv4]);
    renderList();

    await userEvent.click(await rowButton(rows()[0], text.historyDelete));

    expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
  });

  describe('clear all', () => {
    it('asks for confirmation in the page, not with a browser dialog', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      seed([ipv6, ipv4]);
      renderList();

      await userEvent.click(screen.getByRole('button', { name: text.historyClearAll }));

      const group = screen.getByRole('group', { name: text.historyClearConfirm });
      expect(within(group).getByRole('button', { name: text.historyClearCancel })).toHaveFocus();
      expect(confirm).not.toHaveBeenCalled();
      expect(useQueryHistory.getState().entries).toHaveLength(2);
    });

    it('clears every query once confirmed', async () => {
      seed([ipv6, ipv4]);
      renderList();

      await userEvent.click(screen.getByRole('button', { name: text.historyClearAll }));
      const group = screen.getByRole('group', { name: text.historyClearConfirm });
      await userEvent.click(within(group).getByRole('button', { name: text.historyClearAll }));

      expect(useQueryHistory.getState().entries).toEqual([]);
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) as string).state.entries).toEqual([]);
      expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
    });

    it.each([
      [
        'Cancel',
        async () => userEvent.click(screen.getByRole('button', { name: text.historyClearCancel })),
      ],
      ['Escape', async () => userEvent.keyboard('{Escape}')],
    ])('keeps every query with %s', async (_, cancel) => {
      seed([ipv6, ipv4]);
      renderList();
      await userEvent.click(screen.getByRole('button', { name: text.historyClearAll }));

      await cancel();

      expect(
        screen.queryByRole('group', { name: text.historyClearConfirm }),
      ).not.toBeInTheDocument();
      expect(rows()).toHaveLength(2);
      expect(screen.getByRole('button', { name: text.historyClearAll })).toHaveFocus();
    });
  });

  it('works from the keyboard', async () => {
    seed([ipv4]);
    renderList();
    const [row] = rows();
    await rowButton(row, text.historyOpen);
    await rowButton(row, text.historyDelete);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: text.historyClearAll })).toHaveFocus();
    await userEvent.tab();
    expect(within(row).getByRole('button', { name: text.historyOpen })).toHaveFocus();
    await userEvent.tab();
    expect(within(row).getByRole('button', { name: text.historyDelete })).toHaveFocus();

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}');
    expect(useQueryHistory.getState().openId).toBe('v4');
  });

  it('uses the configured text', async () => {
    seed([ipv4]);
    const config = makeConfig({
      web: {
        text: {
          historyTitle: 'Requêtes récentes',
          historyOpen: 'Ouvrir',
          historyDelete: 'Supprimer',
          historyClearAll: 'Tout effacer',
          historyClearConfirm: 'Tout effacer ?',
          historyClearCancel: 'Annuler',
          historySavedAt: 'Enregistrée {time}',
        },
      },
    });
    renderList(config);

    expect(screen.getByRole('heading', { name: 'Requêtes récentes' })).toBeInTheDocument();
    expect(within(rows()[0]).getByRole('button', { name: 'Ouvrir' })).toBeInTheDocument();
    expect(within(rows()[0]).getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent('Enregistrée');
    await userEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(screen.getByRole('group', { name: 'Tout effacer ?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('shows a query saved while it is on the page', () => {
    seed([ipv4]);
    renderList();

    act(() => {
      seed([ipv6, ipv4]);
    });

    expect(rows()).toHaveLength(2);
  });
});
