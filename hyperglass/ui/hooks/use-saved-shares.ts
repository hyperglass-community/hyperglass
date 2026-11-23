import { useCallback, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useConfig } from '~/context';
import { isShareId } from './use-share';

import type { ShareLink } from './use-share-links';

/** The `localStorage` key of the share links created in this browser. */
export const SHARES_KEY = 'hyperglass.shares';

/**
 * The version of the stored value. A value of any other version, older or newer, is
 * deleted on load and replaced on the next save: after a downgrade nothing else would
 * show or delete it, and this browser must not keep tokens the visitor can't see (#550).
 *
 * Whoever changes the format and adds version 2 must migrate version 1 (read it as
 * version 2), not let it be deleted: its delete tokens can't be got back, and the visitor
 * would lose the only way to delete those links before they expire.
 */
const SHARES_VERSION = 1;

/** The longest delete token the server accepts; real ones are 43 characters. */
const MAX_TOKEN = 128;

/** The longest label kept: the labels are shown, never sent. */
const MAX_LABEL = 1024;

/** How a saved link's result is named in the list, as the form showed its query. */
export interface SavedShareLabels {
  /** The location's (device's) name. */
  location: string;
  /** The query type's name. */
  type: string;
  /** The query target, as shown. */
  target: string;
}

/**
 * A share link created in this browser (#562), from a live result or a saved query, with
 * what the visitor needs to see, copy and delete it. The delete token is sent only in the
 * `X-Delete-Token` header of `DELETE /api/share/{id}`, and is `null` once it no longer
 * deletes the link (the result was shared again elsewhere, which replaced it).
 */
export interface SavedShare extends ShareLink {
  /** The `id` of the query response that was shared. */
  queryId: string;
  /** When the link was saved here, in milliseconds since the epoch. */
  savedAt: number;
  labels: SavedShareLabels;
}

/** The value stored under `SHARES_KEY`. */
interface StoredShares {
  version: number;
  links: SavedShare[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LABEL;
}

/** A time a `Date` can hold, in milliseconds since the epoch. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(new Date(value).getTime());
}

/**
 * Whether a value has the shape of a saved link. Storage is under the visitor's control
 * (and other versions'), so this is checked on every read.
 */
export function isSavedShare(value: unknown): value is SavedShare {
  if (!isObject(value) || !isObject(value.labels)) {
    return false;
  }
  const { id, queryId, timestamp, expiresAt, deadline, deleteToken, savedAt, labels } = value;
  return (
    typeof id === 'string' &&
    isShareId(id) &&
    isLabel(queryId) &&
    queryId.length > 0 &&
    isLabel(timestamp) &&
    typeof expiresAt === 'string' &&
    !Number.isNaN(Date.parse(expiresAt)) &&
    isTime(deadline) &&
    (deleteToken === null ||
      (typeof deleteToken === 'string' &&
        deleteToken.length > 0 &&
        deleteToken.length <= MAX_TOKEN)) &&
    isTime(savedAt) &&
    isLabel(labels.location) &&
    isLabel(labels.type) &&
    isLabel(labels.target)
  );
}

/** Whether `share` still works at `now`, by this browser's clock. */
export function isLiveSavedShare(share: Pick<SavedShare, 'deadline'>, now = Date.now()): boolean {
  return share.deadline > now;
}

/** Only the fields of a saved link: what is stored is what is checked on reading. */
function fields(share: SavedShare): SavedShare {
  const { id, queryId, timestamp, expiresAt, deadline, deleteToken, savedAt, labels } = share;
  const { location, type, target } = labels;
  return {
    id,
    queryId,
    timestamp,
    expiresAt,
    deadline,
    deleteToken,
    savedAt,
    labels: { location, type, target },
  };
}

// Storage. A value that can't be written (storage full, or not allowed, as in some private
// modes) is kept in memory for the session instead; nothing stored is dropped to make room.
const memory = new Map<string, string>();

/**
 * Whether the links are kept in the browser's storage (`share.remember_links`, the
 * default). With `false`, for kiosks and shared terminals, they are kept in this page's
 * memory only: nothing is read from or written to the storage (see `configure`).
 */
let remember = true;

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  if (!remember || memory.has(SHARES_KEY)) {
    return memory.get(SHARES_KEY) ?? null;
  }
  try {
    return browserStorage()?.getItem(SHARES_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(value: string | null): void {
  if (!remember) {
    if (value === null) {
      memory.delete(SHARES_KEY);
    } else {
      memory.set(SHARES_KEY, value);
    }
    return;
  }
  const storage = browserStorage();
  try {
    if (storage === null) {
      throw new Error('No storage');
    }
    if (value === null) {
      storage.removeItem(SHARES_KEY);
    } else {
      storage.setItem(SHARES_KEY, value);
    }
    memory.delete(SHARES_KEY);
  } catch {
    if (value === null) {
      memory.delete(SHARES_KEY);
      try {
        storage?.removeItem(SHARES_KEY);
      } catch {
        // Nothing to remove from a storage that can't be used.
      }
    } else {
      memory.set(SHARES_KEY, value);
    }
  }
}

/**
 * The stored links this version reads, or `null` for a value it doesn't: not JSON,
 * another version, or no list.
 */
function parse(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredShares> | null;
    if (parsed?.version !== SHARES_VERSION || !Array.isArray(parsed.links)) {
      return null;
    }
    return parsed.links;
  } catch {
    return null;
  }
}

/** The links in storage now, which another tab may have changed: valid and live only. */
function storedShares(now = Date.now()): SavedShare[] {
  const value = readRaw();
  if (value === null) {
    return [];
  }
  return (parse(value) ?? [])
    .filter((l): l is SavedShare => isSavedShare(l) && isLiveSavedShare(l, now))
    .map(fields);
}

/** Whether a stored link is kept as it is: well-formed, live, and with no other fields. */
function isKeptAsIs(link: unknown, now: number): boolean {
  return (
    isSavedShare(link) &&
    isLiveSavedShare(link, now) &&
    JSON.stringify(fields(link)) === JSON.stringify(link)
  );
}

/** Whether the stored value holds anything this version wouldn't keep. */
function holdsDeadData(now = Date.now()): boolean {
  const value = readRaw();
  if (value === null) {
    return false;
  }
  const links = parse(value);
  return links === null || links.some(l => !isKeptAsIs(l, now));
}

interface SavedSharesState {
  /** Newest first. */
  links: SavedShare[];
  /**
   * Keep `share`, newest first, or replace the link with its id in place (keeping when it
   * was saved), as when its token was replaced. A malformed or expired one is not kept.
   */
  add(share: SavedShare): void;
  /**
   * Drop the token of link `id`, which can no longer delete it (the result was shared
   * again elsewhere), and keep the link. Only while the link is stored: an answer that
   * arrives after the link was forgotten, here or in another tab, brings nothing back.
   */
  dropToken(id: string): void;
  /** Forget link `id`: deleted, gone, or no longer wanted. */
  remove(id: string): void;
  /** Forget every link. The links themselves keep working until they expire. */
  clear(): void;
  /** Drop the links that have expired. Writes only when one has. */
  dropExpired(): void;
  /**
   * Apply `share.remember_links`. Turned off, the links are kept in this page's memory
   * only, and the links this browser stored, and those it read from there, are deleted
   * and forgotten. Configured the same way again, nothing changes.
   */
  configure(rememberLinks: boolean): void;
}

/**
 * The share links created in this browser, with their delete tokens, so the visitor can
 * see, copy and delete them later: from the list "Your shared links", from the result's
 * Share button, and from a saved query's. Kept apart from the query history, so they don't
 * depend on history being on or on its entries being kept. Every change starts from what
 * is stored, so a link another tab forgot doesn't come back. Not in the devtools
 * (`withDev`), so a token is never written anywhere else.
 */
export const useSavedShares = create<SavedSharesState>()((set, get) => {
  function save(links: SavedShare[]): void {
    set({ links });
    writeRaw(links.length > 0 ? JSON.stringify({ version: SHARES_VERSION, links }) : null);
  }

  return {
    links: [],

    add(share: SavedShare): void {
      if (!isSavedShare(share) || !isLiveSavedShare(share)) {
        return;
      }
      const links = storedShares();
      const existing = links.find(l => l.id === share.id);
      if (existing === undefined) {
        save([fields(share), ...links]);
      } else {
        const updated = fields({ ...share, savedAt: existing.savedAt });
        save(links.map(l => (l.id === share.id ? updated : l)));
      }
    },

    dropToken(id: string): void {
      const links = storedShares();
      if (links.some(l => l.id === id)) {
        save(links.map(l => (l.id === id ? { ...l, deleteToken: null } : l)));
      } else if (get().links.some(l => l.id === id)) {
        save(links);
      }
    },

    remove(id: string): void {
      save(storedShares().filter(l => l.id !== id));
    },

    clear(): void {
      save([]);
    },

    configure(rememberLinks: boolean): void {
      if (rememberLinks === remember) {
        return;
      }
      remember = rememberLinks;
      memory.delete(SHARES_KEY);
      if (!rememberLinks) {
        try {
          browserStorage()?.removeItem(SHARES_KEY);
        } catch {
          // Nothing to delete from a storage that can't be used.
        }
      }
      set({ links: storedShares() });
    },

    dropExpired(): void {
      const now = Date.now();
      if (holdsDeadData(now) || get().links.some(l => !isLiveSavedShare(l, now))) {
        save(storedShares(now));
      }
    },
  };
});

/** The saved links of query response `queryId`, newest first. */
export function savedSharesFor(links: SavedShare[], queryId: string): SavedShare[] {
  return links.filter(l => l.queryId === queryId);
}

/**
 * Apply `share.remember_links` to this browser's store of shared links, once the page has
 * mounted: what a view of the links shows, or a Share button saves, follows it.
 */
export function useRememberLinks(): boolean {
  const { share } = useConfig();
  const configure = useSavedShares(s => s.configure);
  useEffect(() => {
    configure(share.rememberLinks);
  }, [configure, share.rememberLinks]);
  return share.rememberLinks;
}

/** A query's links, and how a Share button keeps and forgets them. */
export interface SavedShareLinks {
  links: ShareLink[];
  onAdd(link: ShareLink): void;
  onRemove(id: string): void;
}

/**
 * The links of query response `queryId` saved in this browser, for its Share button, which
 * saves the links it creates with `labels` (how "Your shared links" names them).
 */
export function useSavedShareLinks(queryId: string, labels: SavedShareLabels): SavedShareLinks {
  const rememberLinks = useRememberLinks();
  const configure = useSavedShares(s => s.configure);
  const all = useSavedShares(s => s.links);
  const add = useSavedShares(s => s.add);
  const dropToken = useSavedShares(s => s.dropToken);
  const remove = useSavedShares(s => s.remove);
  const { location, type, target } = labels;
  const links = useMemo(() => savedSharesFor(all, queryId), [all, queryId]);
  const onAdd = useCallback(
    (link: ShareLink) => {
      // A link without its token is one whose token was replaced: an update only, never a
      // link to keep again if it was forgotten meanwhile.
      if (link.deleteToken === null) {
        dropToken(link.id);
        return;
      }
      // Before the first link is kept, in case the effect hasn't run yet.
      configure(rememberLinks);
      add({ ...link, queryId, savedAt: Date.now(), labels: { location, type, target } });
    },
    [add, configure, dropToken, rememberLinks, queryId, location, type, target],
  );
  return { links, onAdd, onRemove: remove };
}

/** The longest delay `setTimeout` takes; a longer one fires at once. */
const MAX_DELAY = 2 ** 31 - 1;

/**
 * While a view of the links shows, drop those that have expired, with their tokens: those
 * already expired (it writes only then), and each one when it expires. An expiry beyond
 * `setTimeout`'s range is left to a later change.
 */
export function useSavedSharesExpiry(): void {
  const links = useSavedShares(s => s.links);
  const dropExpired = useSavedShares(s => s.dropExpired);
  // Counts the timer's runs, to check again: a timer can fire a little before the clock
  // reaches the deadline, and then nothing has expired yet.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    dropExpired();
    const now = Date.now();
    const next = Math.min(...links.map(l => l.deadline).filter(d => d > now));
    if (!Number.isFinite(next) || next - now > MAX_DELAY) {
      return undefined;
    }
    const timer = setTimeout(() => setTick(t => t + 1), next - now);
    return () => clearTimeout(timer);
  }, [links, dropExpired, tick]);
}

if (typeof window !== 'undefined') {
  // On load: show what is stored, and don't keep what this version wouldn't show (another
  // version, malformed or expired links): it is stored again without it, or removed.
  useSavedShares.setState({ links: storedShares() });
  if (holdsDeadData()) {
    const { links } = useSavedShares.getState();
    writeRaw(links.length > 0 ? JSON.stringify({ version: SHARES_VERSION, links }) : null);
  }

  // Another tab saved or forgot links: show its changes. (`key` is `null` when another
  // tab cleared the whole storage.)
  window.addEventListener('storage', event => {
    if (remember && (event.key === SHARES_KEY || event.key === null)) {
      useSavedShares.setState({ links: storedShares() });
    }
  });
}
