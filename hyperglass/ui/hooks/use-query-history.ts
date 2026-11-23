import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { withDev } from '~/util';
import { historyStorage } from '~/util/history-storage';

/** The `localStorage` key of the query history. */
export const HISTORY_KEY = 'hyperglass.history';

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
  /** The entry shown read-only in place of the form, if any. Not stored. */
  openId: string | null;
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
  open(id: string): void;
  close(): void;
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

function isHistoryResult(value: unknown): value is HistoryResult {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.queryId === 'string' &&
    isObject(value.data) &&
    'output' in value.data
  );
}

/**
 * Whether a stored value has the shape of an entry. Storage is under the visitor's
 * control, and a malformed entry must not break the landing page.
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

export const useQueryHistory = create<QueryHistoryState>()(
  persist(
    withDev<QueryHistoryState>(
      (set, get) => ({
        entries: [],
        openId: null,

        record(input: RecordInput, limit: number): void {
          const { submissionId, query, labels, deviceId, result } = input;
          const { entries } = get();
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
          set(state => ({
            entries: state.entries.filter(e => e.id !== id),
            openId: state.openId === id ? null : state.openId,
          }));
        },

        clear(): void {
          set({ entries: [], openId: null });
        },

        prune(limit: number): void {
          const { entries } = get();
          if (entries.length > limit) {
            set({ entries: entries.slice(0, limit) });
          }
        },

        open(id: string): void {
          set({ openId: id });
        },

        close(): void {
          set({ openId: null });
        },
      }),
      'useQueryHistory',
    ),
    {
      name: HISTORY_KEY,
      version: 1,
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
