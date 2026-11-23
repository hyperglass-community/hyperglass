import { describe, expect, it, vi } from 'vitest';
import { createHistoryStorage, dropOldest } from './history-storage';

/** What zustand's `persist` stores: the state's entries, newest first, and a version. */
function payload(ids: string[]): string {
  return JSON.stringify({ state: { entries: ids.map(id => ({ id })) }, version: 1 });
}

function storedIds(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return (JSON.parse(value) as { state: { entries: { id: string }[] } }).state.entries.map(
    e => e.id,
  );
}

function quotaError(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

/**
 * A `Storage` that holds at most `capacity` characters per value and throws
 * `QuotaExceededError` above it, as a full `localStorage` does.
 */
function boundedStorage(capacity: number): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    getItem: (name: string) => items.get(name) ?? null,
    removeItem: (name: string) => {
      items.delete(name);
    },
    setItem: (name: string, value: string) => {
      if (value.length > capacity) {
        throw quotaError();
      }
      items.set(name, value);
    },
  };
}

describe('dropOldest', () => {
  it('drops the last (oldest) entry', () => {
    expect(storedIds(dropOldest(payload(['c', 'b', 'a'])))).toEqual(['c', 'b']);
  });

  it('keeps the version', () => {
    expect(JSON.parse(dropOldest(payload(['b', 'a'])) as string).version).toBe(1);
  });

  it.each([
    ['no entries', payload([])],
    ['no state', JSON.stringify({ version: 1 })],
    ['a value that is not JSON', '{'],
  ])('returns null for %s', (_, value) => {
    expect(dropOldest(value)).toBeNull();
  });
});

describe('createHistoryStorage', () => {
  it('reads and writes the given storage', () => {
    const backing = boundedStorage(10_000);
    const storage = createHistoryStorage(() => backing);

    storage.setItem('key', payload(['a']));

    expect(backing.getItem('key')).toBe(payload(['a']));
    expect(storage.getItem('key')).toBe(payload(['a']));
    storage.removeItem('key');
    expect(backing.getItem('key')).toBeNull();
  });

  it('drops the oldest entries until the value fits', () => {
    const backing = boundedStorage(payload(['c', 'b']).length);
    const storage = createHistoryStorage(() => backing);

    storage.setItem('key', payload(['d', 'c', 'b', 'a']));

    expect(storedIds(backing.getItem('key'))).toEqual(['d', 'c']);
  });

  it('stores no entry when not even the newest one fits', () => {
    const backing = boundedStorage(payload(['a']).length);
    backing.setItem('key', payload(['a']));
    const storage = createHistoryStorage(() => backing);

    storage.setItem('key', payload(['a-much-longer-id']));

    expect(storedIds(backing.getItem('key'))).toEqual([]);
  });

  it('removes the stored value when nothing fits', () => {
    const backing = boundedStorage(4);
    backing.setItem('key', '[]');
    const storage = createHistoryStorage(() => backing);

    storage.setItem('key', payload(['a']));

    expect(backing.getItem('key')).toBeNull();
  });

  it('recognises the quota error Firefox throws', () => {
    const setItem = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new DOMException('Quota reached', 'NS_ERROR_DOM_QUOTA_REACHED');
      })
      .mockImplementation(() => undefined);
    const backing = { ...boundedStorage(10_000), setItem };
    const storage = createHistoryStorage(() => backing);

    storage.setItem('key', payload(['b', 'a']));

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(storedIds(setItem.mock.calls[1][1])).toEqual(['b']);
  });

  it.each([
    [
      'access to it throws',
      () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    ],
    ['there is no storage', () => null],
  ])('keeps the value in memory when %s', (_, getStorage) => {
    const storage = createHistoryStorage(getStorage as () => Storage | null);

    storage.setItem('key', payload(['a']));
    expect(storage.getItem('key')).toBe(payload(['a']));

    storage.removeItem('key');
    expect(storage.getItem('key')).toBeNull();
  });

  it('keeps the value in memory when writing throws something other than a full quota', () => {
    const backing = {
      ...boundedStorage(10_000),
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    const storage = createHistoryStorage(() => backing);

    storage.setItem('key', payload(['a']));

    expect(storage.getItem('key')).toBe(payload(['a']));
  });

  it('reads nothing when reading throws', () => {
    const backing = {
      ...boundedStorage(10_000),
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    const storage = createHistoryStorage(() => backing);

    expect(storage.getItem('key')).toBeNull();
  });
});
