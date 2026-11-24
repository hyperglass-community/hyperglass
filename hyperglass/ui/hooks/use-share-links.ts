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

/** A share as `POST /api/share` answers (#559). */
interface ShareResponse {
  id: string;
  /** When the link stops working, as ISO 8601, by the server's clock. */
  expiresAt: string;
  deleteToken: string;
}

/** A share just created, with when it stops working by this browser's clock. */
export interface CreatedShare extends ShareResponse {
  /**
   * When the link stops working, in milliseconds since the epoch by this browser's clock:
   * the lifetime the server gave, counted from when its answer arrived. A browser clock
   * that is off from the server's doesn't make a live link look expired, or the reverse.
   */
  deadline: number;
}

/**
 * A link created in this browser, as the Share button keeps it. The delete token is sent
 * only in the header of `DELETE /api/share/{id}`; it is `null` once it can no longer
 * delete the link (the result was shared again elsewhere, which replaced it).
 */
export interface ShareLink extends Omit<CreatedShare, 'deleteToken'> {
  deleteToken: string | null;
  /** The `timestamp` of the result the link was created from. */
  timestamp: string;
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

/**
 * `rotated`: the share still exists, but this token no longer deletes it (the same client
 * shared the result again, which gave the share a new token).
 */
export type DeleteShareOutcome =
  | { status: 'deleted' | 'rotated' }
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

function isShareResponse(value: unknown): value is ShareResponse {
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

/** What `createShare` shares: one result of a query response. */
export interface ShareRequest {
  /** The query response's `id`: the query's cache entry. */
  queryId: string;
  /**
   * The query response's `timestamp`: the result shown. The cache entry holds a newer
   * result once the query has run again; the server then answers 404, rather than share
   * a result the visitor hasn't seen.
   */
  timestamp: string;
  /** Seconds to keep the share: one of `share.timeout_choices`. */
  expiresIn: number;
}

export interface ShareLimits {
  /** Milliseconds to wait for the answer. */
  timeout: number;
  /**
   * The longest lifetime a link can have, in milliseconds: the longest of
   * `share.timeout_choices`. A lifetime from the `Date` header outside (0, this] is not
   * believed (a broken or misconfigured clock); the requested time is used instead.
   */
  maxLifetime: number;
}

/**
 * Share the cached result `request` names, with one `POST /api/share`. Only the status of
 * an error response is read: the visitor sees the configured message for it, never the
 * response's text. Nothing is retried.
 */
export async function createShare(
  request: ShareRequest,
  limits: ShareLimits,
): Promise<CreateShareOutcome> {
  const { queryId, timestamp, expiresIn } = request;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(
      '/api/share',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ queryId, timestamp, expiresIn }),
        cache: 'no-store',
      },
      limits.timeout,
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
  if (!isShareResponse(body)) {
    return { status: 'error' };
  }
  const { id, expiresAt, deleteToken } = body;
  // The lifetime by the server's clock: its `expiresAt` less its time of answer (`Date`),
  // which is also right for a share the server reused with its first expiry. Without a
  // `Date` header, or with one that gives a lifetime no share can have, the time asked
  // for, counted from the request.
  const lifetime = Date.parse(expiresAt) - Date.parse(response.headers.get('date') ?? '');
  const deadline =
    lifetime > 0 && lifetime <= limits.maxLifetime
      ? Date.now() + lifetime
      : started + expiresIn * 1000;
  return { status: 'created', share: { id, expiresAt, deleteToken, deadline } };
}

/**
 * Delete share `share.id` with one `DELETE /api/share/{id}`, its token in the
 * `X-Delete-Token` header. A wrong token gets the same 404 as a share that is gone, so a
 * 404 is followed by one `GET /api/share/{id}`, without the token, to tell them apart.
 */
export async function deleteShare(
  share: { id: string; deleteToken: string },
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
  if (response.status === 429) {
    return { status: 'rateLimited' };
  }
  if (response.status !== 404) {
    return { status: 'error' };
  }
  return shareStillExists(share.id, timeout);
}

/** After a delete got 404: whether the share is gone, or exists with another token. */
async function shareStillExists(id: string, timeout: number): Promise<DeleteShareOutcome> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `/api/share/${id}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        // A redirect would be a second request, to wherever it points: fail instead.
        redirect: 'error',
      },
      timeout,
    );
  } catch {
    return { status: 'error' };
  }
  // 422: stored in a snapshot version this version can't read, but there.
  if (response.ok || response.status === 422) {
    return { status: 'rotated' };
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

/** Whether `link` still works at `now`, by this browser's clock. */
export function isLiveLink(link: Pick<ShareLink, 'deadline'>, now: number = Date.now()): boolean {
  return link.deadline > now;
}
