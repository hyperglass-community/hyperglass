import type { StateStorage } from 'zustand/middleware';

/**
 * The value zustand's `persist` stores, without the oldest (last) of its `entries`.
 * Returns `null` when there is no entry left to drop or the value can't be read.
 */
export function dropOldest(serialized: string): string | null {
  let parsed: { state?: { entries?: unknown } };
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  const entries = parsed?.state?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  // Entries are stored newest first.
  return JSON.stringify({ ...parsed, state: { ...parsed.state, entries: entries.slice(0, -1) } });
}

/** Whether `error` is the browser saying the storage is full. */
function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    // Firefox names it differently; the codes are those of older browsers.
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

/**
 * Storage for the query history store that never throws:
 *
 * - When the storage is full, the oldest entries are dropped until the value fits. The
 *   store keeps them in memory until the page is closed.
 * - When there is no storage or the browser doesn't allow it (some private modes throw
 *   on access), the value is kept in memory for the session.
 */
export function createHistoryStorage(
  getStorage: () => Storage | null = browserStorage,
): StateStorage {
  const memory = new Map<string, string>();

  function storage(): Storage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  return {
    getItem(name: string): string | null {
      if (memory.has(name)) {
        return memory.get(name) ?? null;
      }
      try {
        return storage()?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },

    setItem(name: string, value: string): void {
      const target = storage();
      if (target === null) {
        memory.set(name, value);
        return;
      }
      let current: string | null = value;
      while (current !== null) {
        try {
          target.setItem(name, current);
          memory.delete(name);
          return;
        } catch (error) {
          if (!isQuotaError(error)) {
            memory.set(name, value);
            return;
          }
          current = dropOldest(current);
        }
      }
      // Not even the newest entry fits. Don't leave older entries behind that the store
      // no longer has.
      try {
        target.removeItem(name);
      } catch {
        // Nothing more can be done.
      }
    },

    removeItem(name: string): void {
      memory.delete(name);
      try {
        storage()?.removeItem(name);
      } catch {
        // Nothing to remove from a storage that can't be used.
      }
    },
  };
}

/** Storage for the query history store, over `localStorage`. */
export const historyStorage = createHistoryStorage();
