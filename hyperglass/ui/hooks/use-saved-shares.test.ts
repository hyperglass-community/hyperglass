import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHARES_KEY,
  isSavedShare,
  savedSharesFor,
  useSavedShares,
  useSavedSharesExpiry,
} from './use-saved-shares';

import type { SavedShare } from './use-saved-shares';

// The share links created in this browser (#562): their own store, apart from the query
// history, so a visitor can see, copy and delete them whether history is on or not.

const NOW = Date.parse('2026-11-23T10:00:00Z');
const DAY = 86_400_000;
const TOKEN = 'n0t-1n-th3-url_0r-l0gs_7h3-d3l3t3-t0k3n-xyz12';

function share(overrides: Partial<SavedShare> = {}): SavedShare {
  return {
    id: '00112233445566778899aabbccddeeff',
    queryId: `hyperglass.query.${'ab'.repeat(32)}`,
    timestamp: '2026-11-23 09:59:00',
    expiresAt: '2026-12-23T10:00:00Z',
    deadline: NOW + 30 * DAY,
    deleteToken: TOKEN,
    savedAt: NOW,
    labels: { location: 'Router One', type: 'BGP Route', target: '2001:db8::/32' },
    ...overrides,
  };
}

const other = share({ id: 'ffeeddccbbaa99887766554433221100', deleteToken: 'another-t0k3n' });
const expired = share({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', deadline: NOW - 1 });

function stored(): { version: number; links: SavedShare[] } {
  return JSON.parse(localStorage.getItem(SHARES_KEY) as string);
}

function seed(links: unknown[], version = 1): void {
  localStorage.setItem(SHARES_KEY, JSON.stringify({ version, links }));
}

/**
 * A fresh copy of the module, as a page load (or another tab) gets, once the page has
 * applied `share.remember_links` (on, by default).
 */
async function load(rememberLinks = true) {
  vi.resetModules();
  const store = (await import('./use-saved-shares')).useSavedShares;
  store.getState().configure(rememberLinks);
  return store;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Also forgets what a failed write kept in memory.
  useSavedShares.getState().clear();
  localStorage.clear();
  vi.useRealTimers();
});

describe('useSavedShares', () => {
  it(`stores a link under ${SHARES_KEY}, version 1, newest first`, () => {
    useSavedShares.getState().add(share());
    useSavedShares.getState().add(other);

    expect(useSavedShares.getState().links).toEqual([other, share()]);
    expect(stored()).toEqual({ version: 1, links: [other, share()] });
  });

  it('keeps the IPv6 target and the labels as given', () => {
    useSavedShares.getState().add(share());

    expect(stored().links[0].labels).toEqual({
      location: 'Router One',
      type: 'BGP Route',
      target: '2001:db8::/32',
    });
  });

  it('stores only the fields of a link', () => {
    useSavedShares.getState().add({ ...share(), extra: 'x' } as SavedShare);

    expect(stored().links[0]).toEqual(share());
  });

  it('replaces a link with the same id, as when its token was replaced', () => {
    useSavedShares.getState().add(share());

    useSavedShares.getState().add(other);
    vi.setSystemTime(NOW + 1000);

    useSavedShares.getState().add(share({ deleteToken: null, savedAt: NOW + 1000 }));

    // In its place, with the time it was first saved.
    expect(stored().links).toEqual([other, share({ deleteToken: null })]);
    expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
  });

  it.each([
    ['an id that is not a share id', share({ id: '../../api/query' })],
    ['an empty token', share({ deleteToken: '' })],
    ['a token that is too long', share({ deleteToken: 'x'.repeat(129) })],
    ['an expiry that is not a time', share({ expiresAt: 'soon' })],
    ['a deadline that is not a number', share({ deadline: 'soon' as never })],
    ['no labels', share({ labels: undefined as never })],
    [
      'a label that is not text',
      share({ labels: { location: 1, type: 'x', target: 'y' } as never }),
    ],
    ['an empty query id', share({ queryId: '' })],
  ])('does not keep a link with %s', (_, value) => {
    expect(isSavedShare(value)).toBe(false);

    useSavedShares.getState().add(value);

    expect(localStorage.getItem(SHARES_KEY)).toBeNull();
  });

  it('cuts labels too long to fit, and keeps the link with its token', () => {
    // A target with no length limit: 90 IPv6 prefixes, joined as the form shows them.
    const target = Array.from({ length: 45 }, (_, i) => `2001:db8:${i.toString(16)}::/48`)
      .join(', ')
      .repeat(2);
    expect(target.length).toBeGreaterThan(1024);
    useSavedShares
      .getState()
      .add(share({ labels: { location: 'L'.repeat(2000), type: 'BGP Route', target } }));

    const [saved] = stored().links;
    expect(saved.deleteToken).toBe(TOKEN);
    expect(saved.labels).toEqual({
      location: 'L'.repeat(1024),
      type: 'BGP Route',
      target: target.slice(0, 1024),
    });
    expect(useSavedShares.getState().links).toEqual([saved]);
  });

  it('keeps a surrogate pair that ends at the limit', () => {
    const location = `${'a'.repeat(1022)}\u{1F310}rest`;
    useSavedShares.getState().add(share({ labels: { ...share().labels, location } }));

    expect(stored().links[0].labels.location).toBe(`${'a'.repeat(1022)}\u{1F310}`);
  });

  it('does not split a surrogate pair when cutting a label', () => {
    const location = `${'a'.repeat(1023)}\u{1F310}rest`;
    useSavedShares.getState().add(share({ labels: { ...share().labels, location } }));

    expect(stored().links[0].labels.location).toBe('a'.repeat(1023));
  });

  it('does not keep a link that has expired', () => {
    useSavedShares.getState().add(expired);

    expect(useSavedShares.getState().links).toEqual([]);
  });

  describe('dropToken', () => {
    it("drops a stored link's token and keeps the link where it is", () => {
      useSavedShares.getState().add(share());
      useSavedShares.getState().add(other);

      useSavedShares.getState().dropToken(share().id);

      expect(stored().links).toEqual([other, share({ deleteToken: null })]);
      expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
    });

    it('brings back nothing that was forgotten meanwhile', () => {
      useSavedShares.getState().add(share());
      useSavedShares.getState().remove(share().id);

      useSavedShares.getState().dropToken(share().id);

      expect(useSavedShares.getState().links).toEqual([]);
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    });

    it('brings back nothing another tab forgot meanwhile', async () => {
      seed([share()]);
      const one = await load();
      const two = await load();

      two.getState().clear();
      one.getState().dropToken(share().id);

      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
      expect(one.getState().links).toEqual([]);
    });
  });

  it('forgets a link', () => {
    useSavedShares.getState().add(share());
    useSavedShares.getState().add(other);

    useSavedShares.getState().remove(share().id);

    expect(stored().links).toEqual([other]);
    expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
  });

  it('removes the key when the last link is forgotten, and on clear', () => {
    useSavedShares.getState().add(share());
    useSavedShares.getState().remove(share().id);
    expect(localStorage.getItem(SHARES_KEY)).toBeNull();

    useSavedShares.getState().add(share());
    useSavedShares.getState().add(other);
    useSavedShares.getState().clear();

    expect(useSavedShares.getState().links).toEqual([]);
    expect(localStorage.getItem(SHARES_KEY)).toBeNull();
  });

  it('makes no request, also when forgetting or clearing', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    useSavedShares.getState().add(share());
    useSavedShares.getState().remove(share().id);
    useSavedShares.getState().add(share());
    useSavedShares.getState().clear();

    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lists the links of one query', () => {
    const elsewhere = share({ id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', queryId: 'other' });

    expect(savedSharesFor([share(), elsewhere, other], share().queryId)).toEqual([share(), other]);
  });

  describe('expiry', () => {
    it('drops expired links with every change', () => {
      useSavedShares.getState().add(share({ deadline: NOW + 1000 }));
      vi.setSystemTime(NOW + 1000);

      useSavedShares.getState().add(other);

      expect(stored().links).toEqual([other]);
      expect(localStorage.getItem(SHARES_KEY)).not.toContain(TOKEN);
    });

    it('drops them with dropExpired, which writes only when one has expired', () => {
      useSavedShares.getState().add(share({ deadline: NOW + 1000 }));
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

      useSavedShares.getState().dropExpired();
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();

      vi.setSystemTime(NOW + 1000);
      useSavedShares.getState().dropExpired();

      expect(useSavedShares.getState().links).toEqual([]);
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    });

    it('drops an expired link only storage has, as another tab stored it', () => {
      seed([share(), expired]);

      useSavedShares.getState().dropExpired();

      expect(stored().links).toEqual([share()]);
    });
  });

  describe('on load', () => {
    it('reads the stored links, and leaves the value as it is', async () => {
      seed([other, share()]);
      const value = localStorage.getItem(SHARES_KEY);
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      const store = await load();

      expect(store.getState().links).toEqual([other, share()]);
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(SHARES_KEY)).toBe(value);
    });

    it('drops expired and malformed links, and stores the rest again', async () => {
      seed([
        share(),
        expired,
        { id: 'x' },
        'y',
        share({ id: 'cccccccccccccccccccccccccccccccc', deleteToken: 42 as never }),
      ]);

      const store = await load();

      expect(store.getState().links).toEqual([share()]);
      expect(stored()).toEqual({ version: 1, links: [share()] });
    });

    it('drops a stored link whose label is too long', async () => {
      const long = share({
        id: 'dddddddddddddddddddddddddddddddd',
        labels: { ...share().labels, target: 't'.repeat(1025) },
      });
      seed([share(), long]);

      const store = await load();

      expect(store.getState().links).toEqual([share()]);
    });

    it('keeps only the fields of a link, and stores the links again without the rest', async () => {
      seed([{ ...share(), extra: 'x', labels: { ...share().labels, more: 1 } }]);

      const store = await load();

      expect(store.getState().links).toEqual([share()]);
      expect(stored()).toEqual({ version: 1, links: [share()] });
    });

    it('removes a value with nothing left to keep', async () => {
      seed([expired, { id: 'x' }]);

      const store = await load();

      expect(store.getState().links).toEqual([]);
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    });

    it.each([
      ['another version', () => seed([share()], 2)],
      ['a value that is not JSON', () => localStorage.setItem(SHARES_KEY, '{')],
      ['a value without a list', () => localStorage.setItem(SHARES_KEY, '{"version":1}')],
    ])('does not read %s, and removes it', async (_, store) => {
      store();

      const loaded = await load();

      expect(loaded.getState().links).toEqual([]);
      expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    });

    it('leaves the query history alone', async () => {
      const history = JSON.stringify({ state: { entries: [] }, version: 1 });
      localStorage.setItem('hyperglass.history', history);
      seed([expired]);

      await load();

      expect(localStorage.getItem('hyperglass.history')).toBe(history);
    });
  });

  describe('across tabs', () => {
    it('shows the links another tab stores', async () => {
      const one = await load();
      const two = await load();

      one.getState().add(share());
      window.dispatchEvent(new StorageEvent('storage', { key: SHARES_KEY }));

      expect(two.getState().links).toEqual([share()]);
    });

    it('does not bring back a link another tab forgot when saving', async () => {
      seed([share()]);
      const one = await load();
      const two = await load();

      one.getState().remove(share().id);
      two.getState().add(other);

      expect(stored().links).toEqual([other]);
    });

    it('does not undo a link another tab added when forgetting another', async () => {
      seed([other]);
      const one = await load();
      const two = await load();

      one.getState().add(share());
      two.getState().remove(other.id);

      expect(stored().links).toEqual([share()]);
    });

    it.each([
      ['clears the whole storage', () => localStorage.clear(), null],
      ['removes the key', () => localStorage.removeItem(SHARES_KEY), SHARES_KEY],
      ['stores a value that is not JSON', () => localStorage.setItem(SHARES_KEY, '{'), SHARES_KEY],
    ])('shows no links when another tab %s', async (_, change, key) => {
      seed([share()]);
      const two = await load();

      change();
      window.dispatchEvent(new StorageEvent('storage', { key }));

      expect(two.getState().links).toEqual([]);
    });

    it('ignores changes to other keys', async () => {
      seed([share()]);
      const two = await load();
      localStorage.removeItem(SHARES_KEY);

      window.dispatchEvent(new StorageEvent('storage', { key: 'hyperglass.history' }));

      expect(two.getState().links).toEqual([share()]);
    });
  });

  describe('when storage fails', () => {
    it('keeps the links for the session when storage is full', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });

      useSavedShares.getState().add(share());
      useSavedShares.getState().add(other);

      expect(useSavedShares.getState().links).toEqual([other, share()]);
      useSavedShares.getState().remove(other.id);
      expect(useSavedShares.getState().links).toEqual([share()]);
    });

    it('works without storage when using it throws', async () => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      const store = await load();

      store.getState().add(share());

      expect(store.getState().links).toEqual([share()]);
    });
  });
});

describe('useSavedSharesExpiry', () => {
  it('checks again when its timer fires before the deadline by the clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    useSavedShares.getState().add(share({ deadline: NOW + 200 }));
    renderHook(() => useSavedSharesExpiry());

    // The clock goes back a second, so the timer fires while it is still before the
    // deadline, as a timer firing early does.
    vi.setSystemTime(NOW - 1000);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(useSavedShares.getState().links).toHaveLength(1);

    // Checked again at the deadline by the clock, the link goes.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(useSavedShares.getState().links).toEqual([]);
  });
});

// `share.remember_links: false` (#562): for kiosks and shared terminals, the links are kept
// in the page's memory only, and what a browser stored before is deleted.
describe('useSavedShares with remember_links off', () => {
  afterEach(() => {
    useSavedShares.getState().configure(true);
  });

  it('deletes what was stored and forgets it', async () => {
    seed([share()]);
    const store = await load();
    expect(store.getState().links).toEqual([share()]);

    store.getState().configure(false);

    expect(store.getState().links).toEqual([]);
    expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    store.getState().configure(true);
  });

  it('touches storage only to delete what was stored, when the page loads', async () => {
    seed([share()]);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    const store = await load(false);

    expect(getItem.mock.calls.filter(([key]) => key === SHARES_KEY)).toEqual([]);
    expect(setItem.mock.calls.filter(([key]) => key === SHARES_KEY)).toEqual([]);
    expect(removeItem.mock.calls.filter(([key]) => key === SHARES_KEY)).toEqual([[SHARES_KEY]]);
    expect(store.getState().links).toEqual([]);
    expect(localStorage.getItem(SHARES_KEY)).toBeNull();
    store.getState().configure(true);
  });

  it('reads nothing before the page applies the setting', async () => {
    seed([share({ deadline: NOW - 1 })]);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.resetModules();

    const store = (await import('./use-saved-shares')).useSavedShares;

    expect(getItem.mock.calls.filter(([key]) => key === SHARES_KEY)).toEqual([]);
    expect(setItem.mock.calls.filter(([key]) => key === SHARES_KEY)).toEqual([]);
    expect(store.getState().links).toEqual([]);
  });

  it('keeps links in memory and writes nothing to storage', () => {
    useSavedShares.getState().configure(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const { add, dropToken, remove, clear, dropExpired } = useSavedShares.getState();

    add(share());
    add(other);
    expect(useSavedShares.getState().links).toEqual([other, share()]);
    dropToken(share().id);
    expect(useSavedShares.getState().links[1].deleteToken).toBeNull();
    remove(other.id);
    dropExpired();
    expect(useSavedShares.getState().links.map(l => l.id)).toEqual([share().id]);
    clear();

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shows nothing another tab stores', () => {
    useSavedShares.getState().configure(false);

    seed([share()]);
    window.dispatchEvent(new StorageEvent('storage', { key: SHARES_KEY }));

    expect(useSavedShares.getState().links).toEqual([]);
  });

  it('never reads what another tab stores, also when saving', () => {
    useSavedShares.getState().configure(false);
    seed([other]);

    useSavedShares.getState().add(share());

    expect(useSavedShares.getState().links).toEqual([share()]);
  });

  it('keeps its links when configured again the same way', () => {
    useSavedShares.getState().configure(false);
    useSavedShares.getState().add(share());

    useSavedShares.getState().configure(false);

    expect(useSavedShares.getState().links).toEqual([share()]);
  });

  it('changes nothing when remember_links is on', () => {
    seed([share()]);
    useSavedShares.setState({ links: [share()] });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    useSavedShares.getState().configure(true);

    expect(useSavedShares.getState().links).toEqual([share()]);
    expect(removeItem).not.toHaveBeenCalled();
  });
});
