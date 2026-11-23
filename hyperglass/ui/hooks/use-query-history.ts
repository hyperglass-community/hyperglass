import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { withDev } from '~/util';
import { historyStorage } from '~/util/history-storage';

/** The `localStorage` key of the query history. */
export const HISTORY_KEY = 'hyperglass.history';

/** The version of the stored value. */
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
}

interface HistoryViewState {
  /** The entry shown read-only in place of the form, if any. */
  openId: string | null;
  /** The entry last closed, whose Open button gets focus back. */
  returnFocusId: string | null;
  open(id: string): void;
  close(): void;
  /** The entry to return focus to, once: it is forgotten when read. */
  takeReturnFocus(): string | null;
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
function isRenderableResponse(data: unknown): data is QueryResponse {
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
          const { submissionId, query, labels, deviceId, result } = input;
          const entries = storedEntries();
          const existing = entries.find(e => e.id === submissionId);
          if (existing !== undefined) {
            const updated = { ...existing, results: { ...existing.results, [deviceId]: result } };
            set({ entries: entries.map(e => (e === existing ? updated : e)) });
            return;
          }
          const entry: HistoryEntry = {
            id: submissionId,
            savedAt: Date.now(),
            query,
            labels,
            results: { [deviceId]: result },
          };
          set({ entries: [entry, ...entries].slice(0, limit) });
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
      }),
      'useQueryHistory',
    ),
    {
      name: HISTORY_KEY,
      version: HISTORY_VERSION,
      storage: createJSONStorage(() => historyStorage),
      partialize: state => ({ entries: state.entries }),
      // Keep only the stored entries that have the expected shape.
      merge: (persisted, current) => {
        const entries = isObject(persisted) ? persisted.entries : undefined;
        return {
          ...current,
          entries: Array.isArray(entries) ? entries.filter(isHistoryEntry) : current.entries,
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
      open(id: string): void {
        set({ openId: id });
      },
      close(): void {
        const { openId } = get();
        if (openId !== null) {
          set({ openId: null, returnFocusId: openId });
        }
      },
      takeReturnFocus(): string | null {
        const { returnFocusId } = get();
        if (returnFocusId !== null) {
          set({ returnFocusId: null });
        }
        return returnFocusId;
      },
    }),
    'useHistoryView',
  ),
);

// Another tab saved or deleted entries: show its changes. (`key` is `null` when another
// tab cleared the whole storage.)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === HISTORY_KEY || event.key === null) {
      void useQueryHistory.persist.rehydrate();
    }
  });
}
