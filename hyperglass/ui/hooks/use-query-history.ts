import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { withDev } from '~/util';
import { historyStorage } from '~/util/history-storage';

import type { Device } from '~/types';
import type { FormPrefill } from './use-form-state';

/** The `localStorage` key of the query history. */
export const HISTORY_KEY = 'hyperglass.history';

/**
 * The version of the stored value. Whoever changes the format and adds version 2 must add
 * a `migrate` for version 1, and should stop older code from writing over a value of a
 * higher version: this version deletes another version's value on load (see below) and
 * replaces it on its next save.
 *
 * There is deliberately no `migrate` here to quiet zustand's "couldn't be migrated"
 * error for an unknown version: zustand stores the migrated state right away, so a
 * `migrate` would also overwrite a value another tab of another version stores, on that
 * tab's `storage` event.
 */
const HISTORY_VERSION = 1;

/** The query a history entry was submitted with, as sent to `/api/query`. */
export interface HistoryQuery {
  queryLocation: string[];
  queryType: string;
  /** The query type's (directive's) name, to find it again if its ID changes. */
  queryTypeName: string;
  queryTarget: string[];
  queryVariables: Record<string, string>;
}

/** How a history entry is shown in the list, as the form showed the query. */
export interface HistoryLabels {
  /** The locations' names. */
  locations: string[];
  /** The query type's name. */
  type: string;
  target: string;
  /** One `<variable name>: <option name>` label per variable. */
  variables: string[];
}

/** One location's successful response. */
export interface HistoryResult {
  /** The location's name when the query ran. */
  name: string;
  /** The response's query ID. */
  queryId: string;
  data: QueryResponse;
}

/** One submission of the query form. */
export interface HistoryEntry {
  /** The submission's ID. */
  id: string;
  /** When the entry was saved, in milliseconds since the epoch. */
  savedAt: number;
  query: HistoryQuery;
  labels: HistoryLabels;
  /** The successful responses, by location (device) ID. */
  results: Record<string, HistoryResult>;
}

export interface RecordInput {
  submissionId: string;
  query: HistoryQuery;
  labels: HistoryLabels;
  /** The location (device) ID of `result`. */
  deviceId: string;
  result: HistoryResult;
  /**
   * Whether the directive this location ran for the query lets its results be kept
   * (`retain`, see `directiveRetains`). When it doesn't, nothing is saved.
   */
  retain: boolean;
}

interface QueryHistoryState {
  /** Newest first. */
  entries: HistoryEntry[];
  /**
   * Save one location's successful response. The first response of a submission adds
   * an entry and drops the oldest entries beyond `limit`; later ones (another location,
   * or the same one updated) are saved in that entry.
   */
  record(input: RecordInput, limit: number): void;
  remove(id: string): void;
  clear(): void;
  /** Drop the oldest entries beyond `limit`. */
  prune(limit: number): void;
  /**
   * Drop each saved response for which `retains` is false, and the entries left without
   * a response. `retains` gets the entry's query and the response's location ID.
   */
  dropUnretained(retains: (query: HistoryQuery, deviceId: string) => boolean): void;
}

/**
 * What a saved query is reused for: `rerun` fills the form and submits it, `newTarget`
 * fills everything but the target and leaves submitting to the visitor, and `fill` (a
 * shared result's query) fills the form and leaves submitting to the visitor.
 */
export type HistoryReuseMode = 'rerun' | 'newTarget' | 'fill';

/** A saved query handed to the form, which takes it once (see `LookingGlassForm`). */
export interface HistoryReuse {
  query: HistoryQuery;
  /** The locations' names when the query ran, by position in `query.queryLocation`. */
  locations: string[];
  mode: HistoryReuseMode;
}

interface HistoryViewState {
  /** The entry shown read-only in place of the form, if any. */
  openId: string | null;
  /** The entry last closed, whose Open button gets focus back. */
  returnFocusId: string | null;
  /**
   * A saved query the form has yet to take. In memory only, so nothing outside the page
   * (a link, another tab) can make the form submit a query.
   */
  pending: HistoryReuse | null;
  open(id: string): void;
  close(): void;
  /** The entry to return focus to, once: it is forgotten when read. */
  takeReturnFocus(): string | null;
  /** Hand `entry`'s query to the form. */
  reuse(entry: HistoryEntry, mode: HistoryReuseMode): void;
  /** Hand a query that isn't saved here (a shared one) to the form, to fill it only. */
  prefill(query: HistoryQuery, locations: string[]): void;
  /** The query to reuse, once: it is forgotten when read. */
  takeReuse(): HistoryReuse | null;
}

/**
 * The form values of a saved query, for `prefillForm`. Its query type by ID while one of
 * its locations still has that ID, else by name: the ID can change with the configuration
 * (or the first location can be gone, whose ID it was), and `prefillForm` matches a name
 * to each location's own directive. A query with several targets has none here, as the
 * form takes one.
 */
export function historyPrefill(
  query: HistoryQuery,
  getDevice: (id: string) => Device | null,
): FormPrefill {
  const hasId = query.queryLocation.some(
    id => getDevice(id)?.directives.some(d => d.id === query.queryType) ?? false,
  );
  return {
    queryLocation: query.queryLocation,
    queryType: hasId ? query.queryType : query.queryTypeName,
    queryTarget: query.queryTarget.length === 1 ? query.queryTarget[0] : null,
    queryVariables: query.queryVariables,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every(v => typeof v === 'string');
}

/** An object in a list, as each route or hop the result tables render is. */
function isObjectArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isObject);
}

/**
 * Whether a stored response is one the result view can render: a success, with text
 * output, or structured output with the list of routes or hops its table renders.
 */
export function isRenderableResponse(data: unknown): data is QueryResponse {
  if (!isObject(data) || data.level !== 'success') {
    return false;
  }
  const { format, output } = data;
  if (format === 'text/plain') {
    return typeof output === 'string';
  }
  if (format === 'application/json') {
    return isObject(output) && (isObjectArray(output.routes) || isObjectArray(output.hops));
  }
  return false;
}

function isHistoryResult(value: unknown): value is HistoryResult {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.queryId === 'string' &&
    isRenderableResponse(value.data)
  );
}

/**
 * Whether a stored value has the shape of an entry, with responses the result view can
 * render. Storage is under the visitor's control (and other versions), so this is checked
 * on every read.
 */
export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!isObject(value) || !isObject(value.query) || !isObject(value.labels)) {
    return false;
  }
  const { query, labels, results } = value;
  return (
    typeof value.id === 'string' &&
    typeof value.savedAt === 'number' &&
    // A time a `Date` can hold.
    !Number.isNaN(new Date(value.savedAt).getTime()) &&
    isStringArray(query.queryLocation) &&
    typeof query.queryType === 'string' &&
    typeof query.queryTypeName === 'string' &&
    isStringArray(query.queryTarget) &&
    isStringRecord(query.queryVariables) &&
    isStringArray(labels.locations) &&
    typeof labels.type === 'string' &&
    typeof labels.target === 'string' &&
    isStringArray(labels.variables) &&
    isObject(results) &&
    Object.keys(results).length > 0 &&
    Object.values(results).every(isHistoryResult)
  );
}

/** The value `persist` stores. */
interface StoredHistory {
  state: { entries: HistoryEntry[] };
  version: number;
}

/**
 * `persist`'s storage, as JSON. A value that isn't JSON reads as nothing stored, so
 * the store shows no entries rather than keeping the ones it had.
 */
const jsonStorage: PersistStorage<{ entries: HistoryEntry[] }> = {
  getItem(name: string): StorageValue<{ entries: HistoryEntry[] }> | null {
    const value = historyStorage.getItem(name) as string | null;
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
  setItem(name: string, value: StorageValue<{ entries: HistoryEntry[] }>): void {
    historyStorage.setItem(name, JSON.stringify(value));
  },
  removeItem(name: string): void {
    historyStorage.removeItem(name);
  },
};

/**
 * Whether `value` is a stored history this version reads in full: nothing in it is left
 * out when loading.
 */
function isFullyReadable(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Partial<StoredHistory> | null;
    const entries = parsed?.state?.entries;
    return (
      parsed?.version === HISTORY_VERSION && Array.isArray(entries) && entries.every(isHistoryEntry)
    );
  } catch {
    return false;
  }
}

/**
 * The entries in storage now, which another tab may have changed since this tab last
 * read them. An entry another tab deleted must not come back when this tab saves.
 * Nothing stored, a value that isn't JSON or one stored by another version: no entries.
 */
function storedEntries(): HistoryEntry[] {
  const value = historyStorage.getItem(HISTORY_KEY);
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== HISTORY_VERSION || !Array.isArray(parsed?.state?.entries)) {
      return [];
    }
    return parsed.state.entries.filter(isHistoryEntry);
  } catch {
    return [];
  }
}

export const useQueryHistory = create<QueryHistoryState>()(
  persist(
    withDev<QueryHistoryState>(
      (set, get) => ({
        entries: [],

        // Each change starts from the stored entries, not this tab's copy of them.
        record(input: RecordInput, limit: number): void {
          const { submissionId, query, labels, deviceId, result, retain } = input;
          // The location's directive keeps its results out of the history.
          if (!retain) {
            return;
          }
          const entries = storedEntries();
          // The entry may be in memory only: storage was too full to hold it.
          const existing =
            entries.find(e => e.id === submissionId) ??
            get().entries.find(e => e.id === submissionId);
          const entry: HistoryEntry =
            existing === undefined
              ? { id: submissionId, savedAt: Date.now(), query, labels, results: {} }
              : existing;
          const updated = { ...entry, results: { ...entry.results, [deviceId]: result } };
          // Save only what the history can read back and show.
          if (!isHistoryEntry(updated)) {
            return;
          }
          if (entries.some(e => e.id === submissionId)) {
            set({ entries: entries.map(e => (e.id === submissionId ? updated : e)) });
          } else {
            set({ entries: [updated, ...entries].slice(0, limit) });
          }
        },

        remove(id: string): void {
          set({ entries: storedEntries().filter(e => e.id !== id) });
          if (useHistoryView.getState().openId === id) {
            useHistoryView.getState().close();
          }
        },

        clear(): void {
          set({ entries: [] });
          useHistoryView.getState().close();
        },

        prune(limit: number): void {
          const { entries } = get();
          if (entries.length > limit) {
            set({ entries: storedEntries().slice(0, limit) });
          }
        },

        dropUnretained(retains: (query: HistoryQuery, deviceId: string) => boolean): void {
          const keep = (entry: HistoryEntry): HistoryEntry => ({
            ...entry,
            results: Object.fromEntries(
              Object.entries(entry.results).filter(([deviceId]) => retains(entry.query, deviceId)),
            ),
          });
          const dropsAny = (entry: HistoryEntry): boolean =>
            Object.keys(entry.results).some(deviceId => !retains(entry.query, deviceId));
          if (get().entries.some(dropsAny)) {
            set({
              entries: storedEntries()
                .map(keep)
                .filter(entry => Object.keys(entry.results).length > 0),
            });
          }
        },
      }),
      'useQueryHistory',
    ),
    {
      name: HISTORY_KEY,
      version: HISTORY_VERSION,
      storage: jsonStorage,
      partialize: state => ({ entries: state.entries }),
      // Keep only the stored entries that have the expected shape. Nothing readable
      // stored (removed, cleared, not JSON, another version): no entries, also when another
      // tab made it so.
      merge: (persisted, current) => {
        const entries = isObject(persisted) ? persisted.entries : undefined;
        return {
          ...current,
          entries: Array.isArray(entries) ? entries.filter(isHistoryEntry) : [],
        };
      },
    },
  ),
);

/**
 * Which entry is open. Kept apart from the entries, so opening and closing one never
 * writes the history to storage.
 */
export const useHistoryView = create<HistoryViewState>()(
  withDev<HistoryViewState>(
    (set, get) => ({
      openId: null,
      returnFocusId: null,
      pending: null,
      open(id: string): void {
        set({ openId: id });
      },
      close(): void {
        const { openId, pending } = get();
        if (openId !== null) {
          // Closed to reuse its query: focus goes to the form, not to its Open button.
          set({ openId: null, returnFocusId: pending === null ? openId : null });
        }
      },
      takeReturnFocus(): string | null {
        const { returnFocusId } = get();
        if (returnFocusId !== null) {
          set({ returnFocusId: null });
        }
        return returnFocusId;
      },
      reuse(entry: HistoryEntry, mode: HistoryReuseMode): void {
        set({ pending: { query: entry.query, locations: entry.labels.locations, mode } });
      },
      prefill(query: HistoryQuery, locations: string[]): void {
        set({ pending: { query, locations, mode: 'fill' } });
      },
      takeReuse(): HistoryReuse | null {
        const { pending } = get();
        if (pending !== null) {
          set({ pending: null });
        }
        return pending;
      },
    }),
    'useHistoryView',
  ),
);

/**
 * The key hyperglass-ng stored its query history under, in another format. It isn't
 * migrated: it is deleted on load.
 */
const FORK_HISTORY_KEY = 'hyperglass.queryHistory';

// On load, don't keep stored history the visitor can't see or delete: what this version
// can't read is stored again without it, or removed when nothing is left. (Only on load:
// a value another tab, of another version, stores later is that tab's to show.) This
// module loads with every page, whether history is on or off.
if (typeof window !== 'undefined') {
  // `historyStorage` doesn't throw when storage can't be used.
  historyStorage.removeItem(FORK_HISTORY_KEY);
  const value = historyStorage.getItem(HISTORY_KEY);
  if (typeof value === 'string' && !isFullyReadable(value)) {
    const { entries } = useQueryHistory.getState();
    if (entries.length > 0) {
      useQueryHistory.setState({ entries });
    } else {
      useQueryHistory.persist.clearStorage();
    }
  }
}

// Another tab saved or deleted entries: show its changes. (`key` is `null` when another
// tab cleared the whole storage.)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === HISTORY_KEY || event.key === null) {
      void useQueryHistory.persist.rehydrate();
    }
  });
}
