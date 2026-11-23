import { create } from 'zustand';
import { fetchWithTimeout } from '~/util';
import { SHARE_PARAM, isShareId } from './use-share';

import type { Config } from '~/types';

/**
 * The request header that carries a delete token (`DELETE_HEADER` in S1). A token is
 * never put in a URL: URLs end up in browser history, proxy logs and `Referer` headers.
 */
const DELETE_HEADER = 'X-Delete-Token';

/** The longest delete token the server accepts; real ones are 43 characters. */
const MAX_TOKEN = 128;

/**
 * A share as `POST /api/share` created it (#559). The delete token is kept in this
 * browser's memory only, and sent only in the header of `DELETE /api/share/{id}`.
 */
export interface CreatedShare {
  id: string;
  /** When the link stops working, as ISO 8601. */
  expiresAt: string;
  deleteToken: string;
}

/** Why a share request failed, each shown with its own configured message. */
export type ShareFailure =
  | 'resultExpired'
  | 'pending'
  | 'notAllowed'
  | 'tooLarge'
  | 'invalidExpiry'
  | 'rateLimited'
  | 'unavailable'
  | 'notFound'
  | 'error';

export type CreateShareOutcome =
  | { status: 'created'; share: CreatedShare }
  | { status: ShareFailure };

export type DeleteShareOutcome =
  | { status: 'deleted' }
  | { status: Extract<ShareFailure, 'notFound' | 'rateLimited' | 'error'> };

/** The failure of each status `POST /api/share` answers with (S1). */
const CREATE_FAILURES: Record<number, ShareFailure> = {
  400: 'invalidExpiry',
  403: 'notAllowed',
  404: 'resultExpired',
  409: 'pending',
  413: 'tooLarge',
  429: 'rateLimited',
  503: 'unavailable',
};

function isCreatedShare(value: unknown): value is CreatedShare {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { id, expiresAt, deleteToken } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    isShareId(id) &&
    typeof expiresAt === 'string' &&
    !Number.isNaN(Date.parse(expiresAt)) &&
    typeof deleteToken === 'string' &&
    deleteToken.length > 0 &&
    deleteToken.length <= MAX_TOKEN
  );
}

/**
 * Share the cached result of query response `queryId` for `expiresIn` seconds, with one
 * `POST /api/share`. Only the status of an error response is read: the visitor sees the
 * configured message for it, never the response's text. Nothing is retried.
 */
export async function createShare(
  queryId: string,
  expiresIn: number,
  timeout: number,
): Promise<CreateShareOutcome> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      '/api/share',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ queryId, expiresIn }),
        cache: 'no-store',
      },
      timeout,
    );
  } catch {
    return { status: 'error' };
  }
  if (!response.ok) {
    return { status: CREATE_FAILURES[response.status] ?? 'error' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'error' };
  }
  if (!isCreatedShare(body)) {
    return { status: 'error' };
  }
  const { id, expiresAt, deleteToken } = body;
  return { status: 'created', share: { id, expiresAt, deleteToken } };
}

/**
 * Delete `share` with one `DELETE /api/share/{id}`, its token in the `X-Delete-Token`
 * header. A wrong token gets the same 404 as a share that is gone.
 */
export async function deleteShare(
  share: CreatedShare,
  timeout: number,
): Promise<DeleteShareOutcome> {
  if (!isShareId(share.id)) {
    return { status: 'notFound' };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `/api/share/${share.id}`,
      { method: 'DELETE', headers: { [DELETE_HEADER]: share.deleteToken }, cache: 'no-store' },
      timeout,
    );
  } catch {
    return { status: 'error' };
  }
  if (response.ok) {
    return { status: 'deleted' };
  }
  if (response.status === 404) {
    return { status: 'notFound' };
  }
  if (response.status === 429) {
    return { status: 'rateLimited' };
  }
  return { status: 'error' };
}

/**
 * The link to share `id`: this page's origin and path with only the `share` parameter,
 * built in the browser so it works behind a reverse proxy or under a sub-path.
 */
export function shareLink(id: string, page: Pick<Location, 'origin' | 'pathname'>): string {
  return `${page.origin}${page.pathname}?${new URLSearchParams({ [SHARE_PARAM]: id })}`;
}

/** The configured message for a failed share request. */
export function shareFailureMessage(failure: ShareFailure, messages: Config['messages']): string {
  switch (failure) {
    case 'resultExpired':
      return messages.shareResultExpired;
    case 'pending':
      return messages.sharePending;
    case 'notAllowed':
      return messages.shareNotAllowed;
    case 'tooLarge':
      return messages.shareTooLarge;
    case 'invalidExpiry':
      return messages.shareInvalidExpiry;
    case 'rateLimited':
      return messages.rateLimited;
    case 'unavailable':
      return messages.shareUnavailable;
    case 'notFound':
      return messages.shareNotFound;
    default:
      return messages.general;
  }
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * The label of a time to keep a link, in the largest unit it is a whole number of: days,
 * hours, or else minutes (with decimals for a time that isn't whole minutes).
 */
export function keepForLabel(seconds: number, text: Config['web']['text']): string {
  const [one, many, unit] =
    seconds % DAY === 0
      ? [text.shareDay, text.shareDays, DAY]
      : seconds % HOUR === 0
        ? [text.shareHour, text.shareHours, HOUR]
        : [text.shareMinute, text.shareMinutes, MINUTE];
  const count = seconds / unit;
  // Formatted here rather than with `useStrf`: `{count}` is the only field, and this
  // keeps the function usable outside a component.
  const template = count === 1 ? one : many;
  return template.replaceAll('{count}', String(Number(count.toFixed(2))));
}

/** Whether `share` still works at `now`. */
export function isLiveShare(share: CreatedShare, now: number = Date.now()): boolean {
  return Date.parse(share.expiresAt) > now;
}

/**
 * The key of one cached result: the query response's id and the time the device ran it.
 * A result run again (a forced refresh, or after the cache expired) is another result,
 * which the server shares under another link.
 */
export function shareKey(queryId: string, timestamp: string): string {
  return `${queryId} ${timestamp}`;
}

interface ShareLinksState {
  /** The links created in this page, by `shareKey`. */
  links: Record<string, CreatedShare>;
  /** Keep `share` for the result `key`, or forget it with `null`. Drops expired links. */
  save(key: string, share: CreatedShare | null): void;
}

/**
 * The links created from live results, with their delete tokens, so a result's Share
 * button shows its link again while the page is open. Kept in memory only: not in web
 * storage, and not in the devtools (`withDev`), so a token never outlives the page and is
 * never written anywhere. A visitor who reloads can share the same cached result again
 * to get its link back, with a new token.
 */
export const useShareLinks = create<ShareLinksState>()(set => ({
  links: {},
  save(key: string, share: CreatedShare | null): void {
    set(state => {
      const now = Date.now();
      const links = Object.fromEntries(
        Object.entries(state.links).filter(([k, v]) => k !== key && isLiveShare(v, now)),
      );
      if (share !== null) {
        links[key] = share;
      }
      return { links };
    });
  },
}));
