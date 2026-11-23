import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, renderWithProviders, testConfig } from '~/__tests__/render';
import { Layout } from '~/components/layout';
import { useFormState, useHistoryView, useQueryHistory } from '~/hooks';
import Index from '../../pages/index';

import type { HistoryEntry } from '~/hooks';

// The landing page with query history (#556): the recent queries under the form, and a
// saved query opened in place of the form, read-only. The form has its own tests; stub it.
// The page chrome is stubbed as in the layout tests, so `Layout` keeps browser history in
// step with the view.
vi.mock('~/components/looking-glass-form', () => ({
  LookingGlassForm: () => <form aria-label="looking glass form" />,
}));
vi.mock('~/components', async importOriginal => ({
  ...(await importOriginal<typeof import('~/components')>()),
  Debugger: () => null,
  Footer: () => null,
  Greeting: () => null,
  Header: () => null,
}));

const { text } = testConfig.web;
const initialFormState = useFormState.getState();

function entry(id: string, target: string, output: string): HistoryEntry {
  return {
    id,
    savedAt: Date.parse('2026-11-21T10:00:00Z'),
    query: {
      queryLocation: ['router_one'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTypeName: 'BGP Route',
      queryTarget: [target],
      queryVariables: {},
    },
    labels: { locations: ['Router One'], type: 'BGP Route', target, variables: [] },
    results: {
      router_one: {
        name: 'Router One',
        queryId: id,
        data: {
          id,
          random: 'r4nd0m',
          cached: false,
          runtime: 2,
          level: 'success',
          timestamp: '2026-11-21 10:00:00',
          keywords: [],
          output,
          format: 'text/plain',
          enrichment: 'complete',
        },
      },
    },
  };
}

let fetch: ReturnType<typeof vi.fn>;

function renderPage() {
  return renderWithProviders(
    <Layout>
      <Index />
    </Layout>,
  );
}

async function recentQueries(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: text.historyTitle }, IMPORT_WAIT);
}

async function openButton(row: HTMLElement): Promise<HTMLElement> {
  const button = within(row).getByRole('button', { name: text.historyOpen });
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  return button;
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
  fetch = vi.fn(async () => Promise.reject(new Error('no request expected')));
  vi.stubGlobal('fetch', fetch);
  window.history.replaceState(null, '');
  useQueryHistory.setState({
    entries: [
      entry('v6', '2001:db8::/32', 'output for 2001:db8::/32'),
      entry('v4', '192.0.2.0/24', 'output for 192.0.2.0/24'),
    ],
  });
});

afterEach(() => {
  act(() => {
    useFormState.setState(initialFormState, true);
    useQueryHistory.setState({ entries: [] });
    useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  });
  localStorage.clear();
  window.history.replaceState(null, '');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Index page query history', () => {
  it('lists the recent queries under the form', async () => {
    renderPage();

    expect(await recentQueries()).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'looking glass form' })).toBeInTheDocument();
  });

  it('opens a saved query in place of the form, with no request', async () => {
    const { container } = renderPage();
    const rows = within(await recentQueries()).getAllByRole('listitem');

    await userEvent.click(await openButton(rows[1]));

    expect(
      await screen.findByRole('button', { name: text.historyBack }, IMPORT_WAIT),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('pre')).toHaveTextContent('output for 192.0.2.0/24'),
    );
    expect(screen.queryByRole('form', { name: 'looking glass form' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ ultraglass: 'history' });
  });

  it('returns to the form and the list with the Back button', async () => {
    renderPage();
    const rows = within(await recentQueries()).getAllByRole('listitem');
    await userEvent.click(await openButton(rows[0]));

    await userEvent.click(await screen.findByRole('button', { name: text.historyBack }));

    expect(await recentQueries()).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'looking glass form' })).toBeInTheDocument();
    expect(useHistoryView.getState().openId).toBeNull();
    expect(window.history.state).toBeNull();
  });

  it("returns to the form and the list with the browser's Back button", async () => {
    renderPage();
    const rows = within(await recentQueries()).getAllByRole('listitem');
    await userEvent.click(await openButton(rows[0]));
    await screen.findByRole('button', { name: text.historyBack }, IMPORT_WAIT);

    act(() => {
      window.history.back();
    });

    expect(await recentQueries()).toBeInTheDocument();
    expect(useHistoryView.getState().openId).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('focus', () => {
    it.each([
      [
        'the Back button',
        async () => userEvent.click(screen.getByRole('button', { name: text.historyBack })),
      ],
      [
        "the browser's Back button",
        async () =>
          act(() => {
            window.history.back();
          }),
      ],
    ])('returns to the Open button of the closed query with %s', async (_, close) => {
      renderPage();
      const rows = within(await recentQueries()).getAllByRole('listitem');
      await userEvent.click(await openButton(rows[1]));
      await screen.findByRole('button', { name: text.historyBack }, IMPORT_WAIT);

      await close();

      const list = await recentQueries();
      const row = within(list).getAllByRole('listitem')[1];
      await waitFor(() =>
        expect(within(row).getByRole('button', { name: text.historyOpen })).toHaveFocus(),
      );
    });

    it('goes to the list when the opened query was deleted meanwhile', async () => {
      renderPage();
      const rows = within(await recentQueries()).getAllByRole('listitem');
      await userEvent.click(await openButton(rows[1]));
      await screen.findByRole('button', { name: text.historyBack }, IMPORT_WAIT);

      // Another tab deleted it.
      act(() => {
        useQueryHistory.setState({ entries: [useQueryHistory.getState().entries[0]] });
      });

      await recentQueries();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: text.historyTitle })).toHaveFocus(),
      );
    });

    it('goes to the page once every query is cleared', async () => {
      renderPage();
      await userEvent.click(
        within(await recentQueries()).getByRole('button', { name: text.historyClearAll }),
      );
      const group = screen.getByRole('group', { name: text.historyClearConfirm });
      const focus = vi.spyOn(screen.getByRole('main'), 'focus');

      await userEvent.click(within(group).getByRole('button', { name: text.historyClearAll }));

      expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveFocus();
      // Without scrolling to the top of the page, away from where the list was.
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('goes to the page once the last query is deleted', async () => {
      useQueryHistory.setState({ entries: [useQueryHistory.getState().entries[0]] });
      renderPage();
      const [row] = within(await recentQueries()).getAllByRole('listitem');
      const remove = within(row).getByRole('button', { name: text.historyDelete });
      await waitFor(() => expect(remove.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);

      const focus = vi.spyOn(screen.getByRole('main'), 'focus');

      await userEvent.click(remove);

      expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveFocus();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });
});

// hyperglass-ng's history, under a key this version doesn't read, is deleted when the
// page loads, whether history is on or off (#590).
describe("Index page and hyperglass-ng's history", () => {
  it.each([
    ['on', true],
    ['off', false],
  ])('deletes it with history %s', async (_, enable) => {
    localStorage.setItem(
      'hyperglass.queryHistory',
      JSON.stringify({ state: { entries: [entry('old', '2001:db8::/32', 'old')] }, version: 0 }),
    );
    // The page loads with fresh modules, as in a browser.
    vi.resetModules();
    const render = await import('~/__tests__/render');
    const { default: Page } = await import('../../pages/index');

    render.renderWithProviders(<Page />, {
      config: render.makeConfig({ web: { history: { enable } } }),
    });

    expect(await screen.findByRole('form', { name: 'looking glass form' })).toBeInTheDocument();
    expect(localStorage.getItem('hyperglass.queryHistory')).toBeNull();
  });
});
