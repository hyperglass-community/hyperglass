import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_KEY, isHistoryEntry, useHistoryView, useQueryHistory } from './use-query-history';

import type { HistoryEntry, RecordInput } from './use-query-history';

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: 'c0ffee',
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-20 08:00:00',
    keywords: [],
    output: 'show route 2001:db8::/32',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    submissionId: 's1',
    query: {
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTypeName: 'BGP Route',
      queryTarget: ['2001:db8::/32'],
      queryVariables: {},
    },
    labels: {
      locations: ['Router One', 'Router Two'],
      type: 'BGP Route',
      target: '2001:db8::/32',
      variables: [],
    },
    deviceId: 'router_one',
    result: { name: 'Router One', queryId: 'c0ffee', data: response() },
    ...overrides,
  };
}

function entry(id: string, savedAt = 0): HistoryEntry {
  const { query, labels, deviceId, result } = input();
  return { id, savedAt, query, labels, results: { [deviceId]: result } };
}

function stored(): { state: { entries: HistoryEntry[] }; version: number } {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) as string);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
});

afterEach(() => {
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null });
  localStorage.clear();
  vi.useRealTimers();
});

describe('useQueryHistory', () => {
  it('records a submission as an entry, with the time it was saved', () => {
    useQueryHistory.getState().record(input(), 10);

    const { query, labels, result } = input();
    expect(useQueryHistory.getState().entries).toEqual([
      {
        id: 's1',
        savedAt: Date.parse('2026-11-21T10:00:00Z'),
        query,
        labels,
        results: { router_one: result },
      },
    ]);
  });

  it('adds the newest entry first', () => {
    const { record } = useQueryHistory.getState();
    record(input({ submissionId: 'a' }), 10);
    record(input({ submissionId: 'b' }), 10);

    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['b', 'a']);
  });

  it('adds the other locations of a submission to its entry', () => {
    const { record } = useQueryHistory.getState();
    record(input(), 10);
    record(input({ submissionId: 'later' }), 10);
    vi.setSystemTime(new Date('2026-11-21T10:05:00Z'));
    const two = { name: 'Router Two', queryId: 'beef', data: response({ id: 'beef' }) };
    record(input({ deviceId: 'router_two', result: two }), 10);

    const { entries } = useQueryHistory.getState();
    expect(entries.map(e => e.id)).toEqual(['later', 's1']);
    expect(entries[1].results).toEqual({ router_one: input().result, router_two: two });
    // The entry keeps its time and place.
    expect(entries[1].savedAt).toBe(Date.parse('2026-11-21T10:00:00Z'));
  });

  it('updates a location response, as enrichment does', () => {
    const { record } = useQueryHistory.getState();
    record(input(), 10);
    const enriched = response({ output: 'enriched', enrichment: 'complete' });
    record(input({ result: { name: 'Router One', queryId: 'c0ffee', data: enriched } }), 10);

    const { entries } = useQueryHistory.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].results.router_one.data.output).toBe('enriched');
  });

  it('keeps at most `limit` entries, dropping the oldest', () => {
    const { record } = useQueryHistory.getState();
    for (const id of ['a', 'b', 'c', 'd']) {
      record(input({ submissionId: id }), 3);
    }

    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['d', 'c', 'b']);
  });

  it('prunes the entries beyond a lower limit', () => {
    useQueryHistory.setState({ entries: [entry('c'), entry('b'), entry('a')] });

    useQueryHistory.getState().prune(2);

    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['c', 'b']);
  });

  it('deletes an entry', () => {
    useQueryHistory.setState({ entries: [entry('b'), entry('a')] });

    useQueryHistory.getState().remove('b');

    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['a']);
    expect(stored().state.entries.map(e => e.id)).toEqual(['a']);
  });

  it('clears every entry', () => {
    useQueryHistory.setState({ entries: [entry('b'), entry('a')] });

    useQueryHistory.getState().clear();

    expect(useQueryHistory.getState().entries).toEqual([]);
    expect(stored().state.entries).toEqual([]);
  });

  it('opens and closes an entry, and remembers it to return focus to', () => {
    useQueryHistory.setState({ entries: [entry('a')] });
    const { open, close } = useHistoryView.getState();

    open('a');
    expect(useHistoryView.getState().openId).toBe('a');
    close();
    expect(useHistoryView.getState().openId).toBeNull();
    expect(useHistoryView.getState().takeReturnFocus()).toBe('a');
    expect(useHistoryView.getState().takeReturnFocus()).toBeNull();
  });

  it('opens and closes an entry without writing to storage', () => {
    useQueryHistory.getState().record(input(), 10);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    useHistoryView.getState().open('s1');
    useHistoryView.getState().close();

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it.each([
    ['deleting it', () => useQueryHistory.getState().remove('a')],
    ['clearing the history', () => useQueryHistory.getState().clear()],
  ])('closes the opened entry when %s', (_, act) => {
    useQueryHistory.setState({ entries: [entry('a')] });
    useHistoryView.getState().open('a');

    act();

    expect(useHistoryView.getState().openId).toBeNull();
  });

  it(`stores the entries under ${HISTORY_KEY}, version 1`, () => {
    useQueryHistory.getState().record(input(), 10);
    useHistoryView.getState().open('s1');

    expect(stored()).toEqual({
      state: { entries: useQueryHistory.getState().entries },
      version: 1,
    });
  });

  it('keeps the newest entry when storage is full', () => {
    const full = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw full;
    });
    const { record } = useQueryHistory.getState();
    record(input({ submissionId: 'a' }), 10);
    record(input({ submissionId: 'b' }), 10);
    setItem.mockRestore();

    // What is shown is what could be stored, plus the newest entry.
    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['b']);
  });

  it('drops the oldest stored entries when storage is full', () => {
    const { record } = useQueryHistory.getState();
    record(input({ submissionId: 'a' }), 10);
    const capacity = (localStorage.getItem(HISTORY_KEY) as string).length;
    const { setItem } = Storage.prototype;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (value.length > capacity) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    });

    record(input({ submissionId: 'b' }), 10);
    vi.restoreAllMocks();

    expect(stored().state.entries.map(e => e.id)).toEqual(['b']);
    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['b', 'a']);
  });

  it('does not save a response the history could not show', () => {
    const { record } = useQueryHistory.getState();
    const bad = response({ format: 'application/json', output: 'not a table' });
    record(input({ result: { name: 'Router One', queryId: 'c0ffee', data: bad } }), 10);

    expect(useQueryHistory.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it("keeps every location's response of a query in memory when not even it fits in storage", () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const { record } = useQueryHistory.getState();
    record(input(), 10);
    const two = { name: 'Router Two', queryId: 'beef', data: response({ id: 'beef' }) };
    record(input({ deviceId: 'router_two', result: two }), 10);
    vi.restoreAllMocks();

    const { entries } = useQueryHistory.getState();
    expect(entries.map(e => e.id)).toEqual(['s1']);
    expect(Object.keys(entries[0].results)).toEqual(['router_one', 'router_two']);
  });

  it('works without storage when using it throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    useQueryHistory.getState().record(input(), 10);

    expect(useQueryHistory.getState().entries.map(e => e.id)).toEqual(['s1']);
    vi.restoreAllMocks();
  });
});

/** An entry whose one response has `data` changed. */
function withData(data: Record<string, unknown>): unknown {
  const value = entry('a');
  const result = value.results.router_one;
  return { ...value, results: { router_one: { ...result, data: { ...result.data, ...data } } } };
}

describe('isHistoryEntry', () => {
  it('accepts an entry', () => {
    expect(isHistoryEntry(entry('a'))).toBe(true);
  });

  it.each([
    ['BGP routes', { routes: [{ prefix: '2001:db8::/32' }] }],
    ['traceroute hops', { hops: [{ hop_number: 1 }] }],
  ])('accepts structured output with %s', (_, output) => {
    expect(isHistoryEntry(withData({ format: 'application/json', output }))).toBe(true);
  });

  it.each([
    ['null', null],
    ['an entry without results', { ...entry('a'), results: {} }],
    ['an entry with a malformed result', { ...entry('a'), results: { r: { name: 'R' } } }],
    ['an entry without a time', { ...entry('a'), savedAt: 'yesterday' }],
    ['an entry with a time out of range', { ...entry('a'), savedAt: 1e20 }],
    ['an entry without its query', { ...entry('a'), query: undefined }],
    [
      'an entry with a malformed variable',
      { ...entry('a'), query: { ...entry('a').query, queryVariables: { vrf: 1 } } },
    ],
    ['an entry without labels', { ...entry('a'), labels: null }],
    ['a response whose output is a number', withData({ output: 42 })],
    ['a response that is not a success', withData({ level: 'danger' })],
    ['an error response', withData({ level: 'error' })],
    ['text output given as an object', withData({ output: { routes: [] } })],
    [
      'structured output without routes or hops',
      withData({ format: 'application/json', output: {} }),
    ],
    [
      'structured output whose routes are not a list',
      withData({ format: 'application/json', output: { routes: 'x' } }),
    ],
    [
      'structured output whose hops are not a list',
      withData({ format: 'application/json', output: { hops: { 1: {} } } }),
    ],
    [
      'structured output with a route that is not an object',
      withData({ format: 'application/json', output: { routes: [1] } }),
    ],
    ['structured output given as text', withData({ format: 'application/json', output: 'x' })],
    ['an unknown format', withData({ format: 'text/html' })],
  ])('rejects %s', (_, value) => {
    expect(isHistoryEntry(value)).toBe(false);
  });
});

describe('useQueryHistory rehydration', () => {
  // The store reads storage when it is created, at import, so each test seeds storage
  // first and then imports a fresh copy of the module.
  async function freshStore() {
    vi.resetModules();
    return (await import('./use-query-history')).useQueryHistory;
  }

  it('reads the stored entries', async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ state: { entries: [entry('b'), entry('a')] }, version: 1 }),
    );

    const store = await freshStore();

    expect(store.getState().entries).toEqual([entry('b'), entry('a')]);
  });

  it('leaves out stored entries that are malformed', async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ state: { entries: [entry('b'), { id: 'x' }, 'y'] }, version: 1 }),
    );

    const store = await freshStore();

    expect(store.getState().entries).toEqual([entry('b')]);
    // Stored again with only what can be shown, and deleted.
    expect(stored()).toEqual({ state: { entries: [entry('b')] }, version: 1 });
  });

  it('removes a stored value with nothing it can read', async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ state: { entries: [{ id: 'x' }, withData({ output: 42 })] }, version: 1 }),
    );

    const store = await freshStore();

    expect(store.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('leaves out stored entries that the result view could not render', async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        state: {
          entries: [
            entry('b'),
            withData({ output: 42 }),
            withData({ format: 'application/json', output: { routes: 'x' } }),
          ],
        },
        version: 1,
      }),
    );

    const store = await freshStore();

    expect(store.getState().entries).toEqual([entry('b')]);
  });

  it('does not read history stored by another version, and removes it', async () => {
    const newer = JSON.stringify({ state: { entries: [entry('b')], other: 1 }, version: 2 });
    localStorage.setItem(HISTORY_KEY, newer);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const store = await freshStore();

    expect(store.getState().entries).toEqual([]);
    // The visitor couldn't see or delete it.
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('starts empty when the stored value is not JSON, and removes it', async () => {
    localStorage.setItem(HISTORY_KEY, '{');

    const store = await freshStore();

    expect(store.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('leaves a readable stored value as it is', async () => {
    const value = JSON.stringify({ state: { entries: [entry('b')] }, version: 1 });
    localStorage.setItem(HISTORY_KEY, value);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await freshStore();

    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(HISTORY_KEY)).toBe(value);
  });

  it("does not read hyperglass-ng's history", async () => {
    localStorage.setItem(
      'hyperglass.queryHistory',
      JSON.stringify({ state: { entries: [entry('old')] }, version: 1 }),
    );

    const store = await freshStore();

    expect(store.getState().entries).toEqual([]);
  });
});

describe('useQueryHistory across tabs', () => {
  // Each tab has its own store over the same storage: two copies of the module.
  async function tab() {
    vi.resetModules();
    return (await import('./use-query-history')).useQueryHistory;
  }

  beforeEach(() => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ state: { entries: [entry('b'), entry('a')] }, version: 1 }),
    );
  });

  it.each([
    ['Clear all', (store: typeof useQueryHistory) => store.getState().clear(), ['c']],
    ['a deletion', (store: typeof useQueryHistory) => store.getState().remove('b'), ['c', 'a']],
  ])('does not undo %s in another tab when saving a query', async (_, change, expected) => {
    const one = await tab();
    const two = await tab();

    change(one);
    two.getState().record(input({ submissionId: 'c' }), 10);

    expect(stored().state.entries.map(e => e.id)).toEqual(expected);
    expect(two.getState().entries.map(e => e.id)).toEqual(expected);
  });

  it('does not undo a deletion in another tab when deleting', async () => {
    const one = await tab();
    const two = await tab();

    one.getState().remove('b');
    two.getState().remove('a');

    expect(stored().state.entries).toEqual([]);
  });

  it('shows the changes another tab stores', async () => {
    const one = await tab();
    const two = await tab();
    one.getState().clear();
    expect(two.getState().entries).toHaveLength(2);

    window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY }));

    expect(two.getState().entries).toEqual([]);
  });

  it.each([
    ['removes the key', () => localStorage.removeItem(HISTORY_KEY), HISTORY_KEY],
    ['clears the whole storage', () => localStorage.clear(), null],
    [
      'stores a value that is not JSON',
      () => localStorage.setItem(HISTORY_KEY, '{broken'),
      HISTORY_KEY,
    ],
  ])('shows no entries when another tab %s', async (_, change, key) => {
    const two = await tab();
    expect(two.getState().entries).toHaveLength(2);

    change();
    window.dispatchEvent(new StorageEvent('storage', { key }));

    expect(two.getState().entries).toEqual([]);
  });

  it('does not remove a value another tab stores under another version', async () => {
    const two = await tab();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const newer = JSON.stringify({ state: { entries: [entry('b')] }, version: 2 });

    localStorage.setItem(HISTORY_KEY, newer);
    window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY }));

    expect(two.getState().entries).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBe(newer);
  });

  it('does not read entries another tab stored under another version when saving', async () => {
    const two = await tab();
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ state: { entries: [entry('newer')] }, version: 2 }),
    );

    two.getState().record(input({ submissionId: 'c' }), 10);

    expect(stored()).toEqual({ state: { entries: two.getState().entries }, version: 1 });
    expect(two.getState().entries.map(e => e.id)).toEqual(['c']);
  });

  it('ignores changes to other keys', async () => {
    const one = await tab();
    const two = await tab();
    one.getState().clear();

    window.dispatchEvent(new StorageEvent('storage', { key: 'hyperglass-greeting' }));

    expect(two.getState().entries).toHaveLength(2);
  });
});
