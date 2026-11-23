import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { withDev } from '~/util';
import { historyStorage } from '~/util/history-storage';
import { isCreatedShare, isLiveShare } from './use-share-links';

import type { Device } from '~/types';
import type { FormPrefill } from './use-form-state';
import type { CreatedShare } from './use-share-links';

/** The `localStorage` key of the query history. */
export const HISTORY_KEY = 'hyperglass.history';

/**
 * The version of the stored value. Version 2 (#562) adds an optional `share` to each
 * result; version 1 (#556) entries are version 2 entries without one, and are read as
 * such (see `readStored`).
 *
 * A value of any other version, older or newer, is deleted on load (see below) and
 * replaced on the next save. A newer one too: after a downgrade, nothing else would ever
 * show or delete it, and the history must not keep what the visitor can't see.
 *
 * Version 1 is migrated when it is read, not with zustand's `migrate`: zustand stores the
 * migrated state right away, so a `migrate` would also overwrite a value another tab of
 * another version stores, on that tab's `storage` event. There is deliberately no
 * `migrate` to quiet zustand's "couldn't be migrated" error for an unknown version either.
 */
const HISTORY_VERSION = 2;

/** The versions whose stored value this version reads. */
const READABLE_VERSIONS: readonly unknown[] = [1, HISTORY_VERSION];

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
  /**
   * The link created from this result in this browser (#562), with its delete token, so
   * the visitor can copy or delete it later. Dropped once it has expired.
   */
  share?: CreatedShare;
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
  /**
   * Keep `share`, created from the result of location `deviceId` in entry `id`, with that
   * result; or forget it with `null`. Returns whether it was saved: nothing is saved for
   * an entry or a result that isn't stored (deleted in another tab, or too large for the
   * storage) or for a malformed share.
   */
  setShare(id: string, deviceId: string, share: CreatedShare | null): boolean;
  /** Drop the shares that have expired. Writes only when one has. */
  dropExpiredShares(): void;
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
    isRenderableResponse(value.data) &&
    (value.share === undefined || isCreatedShare(value.share))
  );
}

/** Whether any result of `entry` has a share that still works at `now`. */
export function hasLiveShare(entry: HistoryEntry, now: number = Date.now()): boolean {
  return Object.values(entry.results).some(r => r.share !== undefined && isLiveShare(r.share, now));
}

/** Whether `result` has a share that is malformed or has expired at `now`. */
function hasDeadShare(result: unknown, now: number): boolean {
  if (!isObject(result) || result.share === undefined) {
    return false;
  }
  return !(isCreatedShare(result.share) && isLiveShare(result.share, now));
}

/**
 * A stored entry without the shares that are malformed or have expired: the entry is
 * kept, and a delete token that can no longer delete anything is not.
 */
function withoutDeadShares(value: unknown, now: number = Date.now()): unknown {
  if (!isObject(value) || !isObject(value.results)) {
    return value;
  }
  const results = value.results;
  if (!Object.values(results).some(r => hasDeadShare(r, now))) {
    return value;
  }
  return {
    ...value,
    results: Object.fromEntries(
      Object.entries(results).map(([deviceId, result]) => {
        if (!hasDeadShare(result, now)) {
          return [deviceId, result];
        }
        const { share: _, ...rest } = result as Record<string, unknown>;
        return [deviceId, rest];
      }),
    ),
  };
}

/** The entries of a stored list this version can show, without dead shares. */
function readableEntries(entries: unknown[]): HistoryEntry[] {
  const now = Date.now();
  return entries.map(e => withoutDeadShares(e, now)).filter(isHistoryEntry);
}

/**
 * The share fields of `share` only, or `undefined` for a share that is malformed: what is
 * stored is what the history checks on reading.
 */
function shareFields(share: CreatedShare): CreatedShare | undefined {
  if (!isCreatedShare(share)) {
    return undefined;
  }
  const { id, expiresAt, deleteToken } = share;
  return { id, expiresAt, deleteToken };
}

/**
 * The result of a location as saved again: it keeps its share when it is the same result
 * (the same response, updated by enrichment), not when another one replaces it, as a run
 * of the query again does: the link is to the result it was created from.
 */
function replaceResult(previous: HistoryResult | undefined, next: HistoryResult): HistoryResult {
  const { share: _, ...result } = next;
  if (
    previous?.share !== undefined &&
    previous.data.id === next.data.id &&
    previous.data.timestamp === next.data.timestamp
  ) {
    return { ...result, share: previous.share };
  }
  return result;
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
 * A stored value, parsed, as this version reads it: a version 1 value is read as
 * version 2, which only adds an optional field.
 */
function readStored(value: string): StoredHistory | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isObject(parsed)) {
    return null;
  }
  if (parsed.version === 1) {
    return { ...(parsed as unknown as StoredHistory), version: HISTORY_VERSION };
  }
  return parsed as unknown as StoredHistory;
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
    return readStored(value);
  },
  setItem(name: string, value: StorageValue<{ entries: HistoryEntry[] }>): void {
    historyStorage.setItem(name, JSON.stringify(value));
  },
  removeItem(name: string): void {
    historyStorage.removeItem(name);
  },
};

/**
 * Whether `value` is a stored history of this version that is read in full: nothing in it
 * is left out when loading, and it holds no share that is malformed or has expired.
 */
function isFullyReadable(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Partial<StoredHistory> | null;
    const entries = parsed?.state?.entries;
    const now = Date.now();
    return (
      parsed?.version === HISTORY_VERSION &&
      Array.isArray(entries) &&
      entries.every(
        e =>
          isHistoryEntry(e) &&
          !Object.values((e as HistoryEntry).results).some(r => hasDeadShare(r, now)),
      )
    );
  } catch {
    return false;
  }
}

/**
 * The entries in storage now, which another tab may have changed since this tab last
 * read them. An entry or a share another tab deleted must not come back when this tab
 * saves. Nothing stored, a value that isn't JSON or one stored by a version this one
 * doesn't read: no entries. Expired shares are left out, so every save drops them.
 */
function storedEntries(): HistoryEntry[] {
  const value = historyStorage.getItem(HISTORY_KEY);
  if (typeof value !== 'string') {
    return [];
  }
  const parsed = readStored(value);
  if (
    parsed === null ||
    !READABLE_VERSIONS.includes(parsed.version) ||
    !Array.isArray(parsed.state?.entries)
  ) {
    return [];
  }
  return readableEntries(parsed.state.entries);
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
          const updated = {
            ...entry,
            results: {
              ...entry.results,
              [deviceId]: replaceResult(entry.results[deviceId], result),
            },
          };
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

        setShare(id: string, deviceId: string, share: CreatedShare | null): boolean {
          const fields = share === null ? undefined : shareFields(share);
          if (share !== null && fields === undefined) {
            return false;
          }
          // Only an entry as stored: one in this tab's memory only may have been deleted in
          // another tab, and saving it would bring it back.
          const entries = storedEntries();
          const entry = entries.find(e => e.id === id);
          const result = entry?.results[deviceId];
          if (entry === undefined || result === undefined) {
            return false;
          }
          const { share: _, ...rest } = result;
          const updated: HistoryEntry = {
            ...entry,
            results: {
              ...entry.results,
              [deviceId]: fields === undefined ? rest : { ...rest, share: fields },
            },
          };
          set({ entries: entries.map(e => (e.id === id ? updated : e)) });
          return true;
        },

        dropExpiredShares(): void {
          const now = Date.now();
          const anyDead = (entries: unknown[]): boolean =>
            entries.some(
              e =>
                isObject(e) &&
                isObject(e.results) &&
                Object.values(e.results).some(r => hasDeadShare(r, now)),
            );
          // Also when only storage has one, as another tab stored it: this tab's copy
          // leaves dead shares out on reading.
          const value = historyStorage.getItem(HISTORY_KEY);
          const stored = typeof value === 'string' ? readStored(value) : null;
          const inStorage =
            stored !== null &&
            READABLE_VERSIONS.includes(stored.version) &&
            Array.isArray(stored.state?.entries) &&
            anyDead(stored.state.entries);
          if (inStorage || anyDead(get().entries)) {
            set({ entries: storedEntries() });
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
          entries: Array.isArray(entries) ? readableEntries(entries) : [],
        };
      },
    },
  ),
);

/** The longest delay `setTimeout` takes; a longer one fires at once. */
const MAX_DELAY = 2 ** 31 - 1;

/** When the first of the entries' shares that still work expires, if any. */
function nextExpiry(entries: HistoryEntry[], now: number): number | null {
  let next: number | null = null;
  for (const entry of entries) {
    for (const result of Object.values(entry.results)) {
      const at = result.share === undefined ? Number.NaN : Date.parse(result.share.expiresAt);
      if (at > now && (next === null || at < next)) {
        next = at;
      }
    }
  }
  return next;
}

/**
 * While the history shows (the list or an opened entry), drop the shares that have
 * expired, with their delete tokens: those already expired (it writes only then), and each
 * one when it expires, which also removes its mark. An expiry beyond `setTimeout`'s range
 * is left to a later change.
 */
export function useDropExpiredShares(enable: boolean): void {
  const entries = useQueryHistory(s => s.entries);
  const dropExpiredShares = useQueryHistory(s => s.dropExpiredShares);
  // Counts the timer's runs, to check again: a timer can fire a little before the clock
  // reaches the expiry, and then nothing has expired yet.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enable || entries.length === 0) {
      return undefined;
    }
    dropExpiredShares();
    const now = Date.now();
    const next = nextExpiry(entries, now);
    if (next === null || next - now > MAX_DELAY) {
      return undefined;
    }
    const timer = setTimeout(() => setTick(t => t + 1), next - now);
    return () => clearTimeout(timer);
  }, [enable, entries, dropExpiredShares, tick]);
}

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
