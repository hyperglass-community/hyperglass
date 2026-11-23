import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { SHARES_KEY, useQueryHistory, useRememberLinks, useSavedShares } from '~/hooks';
import { formatTimestamp } from '~/util';
import { SavedShares } from './saved-shares';

import type { SavedShare } from '~/hooks';
import type { Config } from '~/types';

// "Your shared links" (#562): the links created in this browser, from live results or
// saved queries, to copy or delete later. Shown whether query history is on or not.

const { text } = testConfig.web;
/** Fake timers that follow real time for Testing Library; intervals and frames stay real. */
const FAKE: Parameters<typeof vi.useFakeTimers>[0] = {
  shouldAdvanceTime: true,
  toFake: ['setTimeout', 'clearTimeout', 'Date'],
};
const TOKEN = 'y0ur-sh4r3d-l1nks_d3l3t3-t0k3n-n0t-1n-th3-url';
const ONE = '00112233445566778899aabbccddeeff';
const TWO = 'ffeeddccbbaa99887766554433221100';

function saved(overrides: Partial<SavedShare> = {}): SavedShare {
  return {
    id: ONE,
    queryId: `hyperglass.query.${'ab'.repeat(32)}`,
    timestamp: '2026-11-20 08:00:00',
    expiresAt: '2099-12-21T08:00:00Z',
    deadline: Date.now() + 30 * 86_400_000,
    deleteToken: TOKEN,
    savedAt: Date.now(),
    labels: { location: 'Router One', type: 'BGP Route', target: '2001:db8::/32' },
    ...overrides,
  };
}

const second = (): SavedShare =>
  saved({
    id: TWO,
    deleteToken: 'another-t0k3n',
    labels: { location: 'Router Three', type: 'Ping', target: '192.0.2.1' },
  });

function config(overrides: Parameters<typeof makeConfig>[0] = {}): Config {
  return makeConfig({ share: { enable: true }, ...overrides });
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let calls: Call[];

/** `DELETE` answers `deleteStatus`; a `GET` after it answers `getStatus`. */
function stubFetch(deleteStatus = 204, getStatus = 404): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      calls.push({ url, method: init.method ?? 'GET', headers });
      if (init.method === 'DELETE') {
        return new Response(deleteStatus === 204 ? null : 'SERVER TEXT', { status: deleteStatus });
      }
      return new Response(getStatus === 200 ? '{}' : 'SERVER TEXT', { status: getStatus });
    }),
  );
}

function renderList(cfg: Config = config()) {
  return renderWithProviders(
    <main tabIndex={-1}>
      <SavedShares />
    </main>,
    { config: cfg },
  );
}

const section = (): HTMLElement | null => screen.queryByRole('region', { name: text.sharesTitle });

function rows(): HTMLElement[] {
  return within(section() as HTMLElement).getAllByRole('listitem');
}

/** The buttons and field of the row of the `type` link of `target` at `location`. */
function rowGroup(type: string, target: string, location: string): HTMLElement {
  return screen.getByRole('group', { name: `${type} ${target} ${location}` });
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useSavedShares.getState().clear();
  useQueryHistory.setState({ entries: [] });
  localStorage.clear();
});

describe('SavedShares', () => {
  it('shows nothing when no link was shared from this browser', () => {
    renderList();

    expect(section()).toBeNull();
  });

  it('lists the links, newest first, with what was shared, when, and until when', () => {
    useSavedShares.getState().add(saved());
    useSavedShares.getState().add(second());
    renderList();

    expect(within(section() as HTMLElement).getByRole('heading', { name: text.sharesTitle }));
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent('Ping');
    const row = rows()[1];
    expect(row).toHaveTextContent('BGP Route');
    expect(row).toHaveTextContent('2001:db8::/32');
    expect(row).toHaveTextContent('Router One');
    expect(row).toHaveTextContent(`Result from ${formatTimestamp('2026-11-20 08:00:00')}`);
    expect(row).toHaveTextContent(`Link expires ${formatTimestamp('2099-12-21T08:00:00Z')}`);
    const group = rowGroup('BGP Route', '2001:db8::/32', 'Router One');
    expect(within(group).getByRole('textbox', { name: text.shareLink })).toHaveValue(
      `${window.location.origin}/?share=${ONE}`,
    );
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('is shown with query history turned off, and after the history is cleared', () => {
    useSavedShares.getState().add(saved());
    useQueryHistory.getState().clear();
    renderList(config({ web: { history: { enable: false } } }));

    expect(rows()).toHaveLength(1);
  });

  it('shows nothing, and forgets every link, when sharing is off', () => {
    useSavedShares.getState().add(saved());
    renderList(makeConfig({ share: { enable: false } }));

    expect(section()).toBeNull();
    expect(useSavedShares.getState().links).toEqual([]);
    expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('forgets every link when sharing is off, on a page without the list', () => {
    useSavedShares.getState().add(saved());
    const Page = (): null => {
      useRememberLinks();
      return null;
    };
    renderWithProviders(<Page />, { config: makeConfig({ share: { enable: false } }) });

    expect(useSavedShares.getState().links).toEqual([]);
    expect(localStorage.getItem(SHARES_KEY)).toBeNull();
  });

  it('copies a link', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    useSavedShares.getState().add(saved());
    useSavedShares.getState().add(second());
    renderList();

    await userEvent.click(
      within(rowGroup('BGP Route', '2001:db8::/32', 'Router One')).getByRole('button', {
        name: text.copyLink,
      }),
    );

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?share=${ONE}`);
    expect(screen.getByRole('status')).toHaveTextContent(text.linkCopied);
    // Shown on the row copied, not on the others.
    expect(rowGroup('BGP Route', '2001:db8::/32', 'Router One')).toHaveTextContent(text.linkCopied);
    expect(rowGroup('Ping', '192.0.2.1', 'Router Three')).not.toHaveTextContent(text.linkCopied);
  });

  it('clears what it said a few seconds later, so it does not linger', async () => {
    vi.useFakeTimers(FAKE);
    try {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      useSavedShares.getState().add(saved());
      useSavedShares.getState().add(second());
      renderList();
      const group = rowGroup('BGP Route', '2001:db8::/32', 'Router One');

      await userEvent.click(within(group).getByRole('button', { name: text.copyLink }));
      expect(screen.getByRole('status')).toHaveTextContent(text.linkCopied);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByRole('status')).toHaveTextContent('');
      expect(group).not.toHaveTextContent(text.linkCopied);

      await userEvent.click(within(group).getByRole('button', { name: text.shareDelete }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text.shareDeleted));
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByRole('status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects the link to copy by hand when the browser can not copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    useSavedShares.getState().add(saved());
    renderList();
    const group = rowGroup('BGP Route', '2001:db8::/32', 'Router One');

    await userEvent.click(within(group).getByRole('button', { name: text.copyLink }));

    const field = within(group).getByRole('textbox', { name: text.shareLink }) as HTMLInputElement;
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
  });

  it('deletes a link with its token in the header only, and forgets it', async () => {
    useSavedShares.getState().add(saved());
    useSavedShares.getState().add(second());
    renderList();

    await userEvent.click(
      within(rowGroup('BGP Route', '2001:db8::/32', 'Router One')).getByRole('button', {
        name: text.shareDelete,
      }),
    );

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(calls).toEqual([
      { url: `/api/share/${ONE}`, method: 'DELETE', headers: { 'x-delete-token': TOKEN } },
    ]);
    expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
    expect(screen.getByRole('status')).toHaveTextContent(text.shareDeleted);
    expect(screen.getByRole('heading', { name: text.sharesTitle })).toHaveFocus();
  });

  it('moves focus to the page when the last link is deleted', async () => {
    useSavedShares.getState().add(saved());
    renderList();

    await userEvent.click(screen.getByRole('button', { name: text.shareDelete }));

    await waitFor(() => expect(section()).toBeNull());
    expect(screen.getByRole('main')).toHaveFocus();
    // The status region stays, so the deletion is announced.
    expect(screen.getByRole('status')).toHaveTextContent(text.shareDeleted);
  });

  it('forgets a link that is already gone, with the configured message', async () => {
    stubFetch(404, 404);
    useSavedShares.getState().add(saved());
    useSavedShares.getState().add(second());
    renderList(config({ messages: { shareNotFound: 'Already gone.' } }));

    await userEvent.click(
      within(rowGroup('BGP Route', '2001:db8::/32', 'Router One')).getByRole('button', {
        name: text.shareDelete,
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Already gone.');
    expect(rows()).toHaveLength(1);
    expect(document.body).not.toHaveTextContent('SERVER TEXT');
  });

  it('says the last link was already gone, after the list goes', async () => {
    stubFetch(404, 404);
    useSavedShares.getState().add(saved());
    renderList(config({ messages: { shareNotFound: 'Already gone.' } }));

    await userEvent.click(screen.getByRole('button', { name: text.shareDelete }));

    await waitFor(() => expect(section()).toBeNull());
    expect(screen.getByRole('alert')).toHaveTextContent('Already gone.');
  });

  it('keeps a link whose token was replaced, without its token, and lets it be forgotten', async () => {
    stubFetch(404, 200);
    useSavedShares.getState().add(saved());
    renderList();

    await userEvent.click(screen.getByRole('button', { name: text.shareDelete }));

    const group = rowGroup('BGP Route', '2001:db8::/32', 'Router One');
    await within(group).findByText(text.shareDeleteRotated);
    expect(useSavedShares.getState().links).toEqual([
      expect.objectContaining({ id: ONE, deleteToken: null }),
    ]);
    expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
    expect(within(group).queryByRole('button', { name: text.shareDelete })).toBeNull();
    const before = calls.length;

    await userEvent.click(within(group).getByRole('button', { name: text.sharesForget }));

    expect(section()).toBeNull();
    expect(calls).toHaveLength(before);
  });

  describe('a late answer that the token was replaced', () => {
    /** `DELETE` answers 404 once `release` is called; the `GET` after it, 200. */
    function stubSlowRotation(): () => void {
      calls = [];
      let release = (): void => undefined;
      const answered = new Promise<void>(resolve => {
        release = resolve;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit = {}) => {
          calls.push({ url, method: init.method ?? 'GET', headers: {} });
          if (init.method === 'DELETE') {
            await answered;
            return new Response('', { status: 404 });
          }
          return new Response('{}', { status: 200 });
        }),
      );
      return release;
    }

    it('does not bring back a link forgotten with Forget all meanwhile', async () => {
      const release = stubSlowRotation();
      useSavedShares.getState().add(saved());
      renderList();
      await userEvent.click(screen.getByRole('button', { name: text.shareDelete }));
      await userEvent.click(screen.getByRole('button', { name: text.sharesClearAll }));
      await userEvent.click(
        within(screen.getByRole('group', { name: text.sharesClearConfirm })).getByRole('button', {
          name: text.sharesClearAll,
        }),
      );

      await act(async () => {
        release();
        await Promise.resolve();
      });

      await waitFor(() => expect(calls.map(c => c.method)).toEqual(['DELETE', 'GET']));
      expect(useSavedShares.getState().links).toEqual([]);
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
      expect(section()).toBeNull();
    });

    it('does not bring back a link another tab forgot meanwhile', async () => {
      const release = stubSlowRotation();
      useSavedShares.getState().add(saved());
      renderList();
      await userEvent.click(screen.getByRole('button', { name: text.shareDelete }));

      // Another tab forgets every link.
      localStorage.removeItem(SHARES_KEY);
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: SHARES_KEY }));
      });
      await act(async () => {
        release();
        await Promise.resolve();
      });

      await waitFor(() => expect(calls.map(c => c.method)).toEqual(['DELETE', 'GET']));
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
      expect(useSavedShares.getState().links).toEqual([]);
    });
  });

  it('sends one delete request for two quick presses', async () => {
    let release = (): void => undefined;
    const answered = new Promise<void>(resolve => {
      release = resolve;
    });
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? 'GET', headers: {} });
        await answered;
        return new Response(null, { status: 204 });
      }),
    );
    useSavedShares.getState().add(saved());
    renderList();
    const button = screen.getByRole('button', { name: text.shareDelete });

    await userEvent.click(button);
    await userEvent.click(button);
    await act(async () => {
      release();
      await Promise.resolve();
    });

    await waitFor(() => expect(section()).toBeNull());
    expect(calls).toHaveLength(1);
  });

  it('keeps the link when deleting is refused for now', async () => {
    stubFetch(429);
    useSavedShares.getState().add(saved());
    renderList();

    await userEvent.click(screen.getByRole('button', { name: text.shareDelete }));

    expect(await screen.findByRole('alert')).toHaveTextContent(testConfig.messages.rateLimited);
    expect(useSavedShares.getState().links.map(l => l.deleteToken)).toEqual([TOKEN]);
  });

  describe('forget all', () => {
    async function pressForgetAll(): Promise<HTMLElement> {
      await userEvent.click(screen.getByRole('button', { name: text.sharesClearAll }));
      return screen.getByRole('group', { name: text.sharesClearConfirm });
    }

    it('asks first, in the page, saying the links keep working', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      useSavedShares.getState().add(saved());
      renderList();

      const group = await pressForgetAll();

      expect(within(group).getByRole('button', { name: text.sharesClearCancel })).toHaveFocus();
      expect(confirm).not.toHaveBeenCalled();
      expect(useSavedShares.getState().links).toHaveLength(1);
    });

    it.each([
      [
        'Cancel',
        async () => userEvent.click(screen.getByRole('button', { name: text.sharesClearCancel })),
      ],
      ['Escape', async () => userEvent.keyboard('{Escape}')],
    ])('keeps every link with %s', async (_, cancel) => {
      useSavedShares.getState().add(saved());
      renderList();
      await pressForgetAll();

      await cancel();

      expect(screen.queryByRole('group', { name: text.sharesClearConfirm })).toBeNull();
      expect(rows()).toHaveLength(1);
      expect(screen.getByRole('button', { name: text.sharesClearAll })).toHaveFocus();
    });

    it('forgets every token once confirmed, without deleting the links on the server', async () => {
      useSavedShares.getState().add(saved());
      useSavedShares.getState().add(second());
      renderList();
      const group = await pressForgetAll();

      await userEvent.click(within(group).getByRole('button', { name: text.sharesClearAll }));

      expect(section()).toBeNull();
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
      expect(calls).toEqual([]);
      expect(screen.getByRole('main')).toHaveFocus();
    });
  });

  it('drops a link when it expires while the list shows', async () => {
    vi.useFakeTimers(FAKE);
    try {
      useSavedShares.getState().add(saved({ deadline: Date.now() + 60 * 60_000 }));
      useSavedShares.getState().add(second());
      renderList();
      expect(rows()).toHaveLength(2);

      await act(async () => {
        vi.advanceTimersByTime(60 * 60_000);
      });

      expect(rows()).toHaveLength(1);
      expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a link another tab saves', async () => {
    useSavedShares.getState().add(second());
    renderList();

    const stored = JSON.parse(localStorage.getItem(SHARES_KEY) as string);
    localStorage.setItem(
      SHARES_KEY,
      JSON.stringify({ ...stored, links: [saved(), ...stored.links] }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SHARES_KEY }));
    });

    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('uses the configured text', async () => {
    useSavedShares.getState().add(saved());
    renderList(
      config({
        web: {
          text: {
            sharesTitle: 'Mes liens',
            sharesClearAll: 'Tout oublier',
            sharesClearConfirm: 'Oublier ?',
            sharesClearCancel: 'Annuler',
          },
        },
      }),
    );

    expect(screen.getByRole('region', { name: 'Mes liens' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tout oublier' }));
    expect(screen.getByRole('group', { name: 'Oublier ?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
  });
});
