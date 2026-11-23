import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useConfig } from '~/context';
import { fetchWithTimeout, withDev } from '~/util';
import { isRenderableResponse } from './use-query-history';

import type { HistoryQuery } from './use-query-history';

/**
 * The query parameter of a share link: `/?share=<id>`. The landing page shows the shared
 * result instead of the form, so a link works with the static export and wherever the UI
 * is served from.
 */
export const SHARE_PARAM = 'share';

/** A share id as `POST /api/share` creates it: 16 random bytes in hex (#559). */
const SHARE_ID = /^[0-9a-f]{32}$/;

/** The query of one shared result, as the server stored it. */
export interface SharedQuery {
  /** Device ID. */
  location: string;
  /** Directive ID. */
  queryType: string;
  /** Directive name, which finds the same query type under another ID. */
  queryTypeName: string;
  target: string | string[];
  /** Variable values by variable ID. */
  variables: Record<string, string>;
}

/** One device's result in a share. */
export interface SharedResult {
  query: SharedQuery;
  /** Display names of the location and query type when the result was shared. */
  labels: { location: string; queryType: string };
  output: string | AllStructuredResponses;
  format: 'text/plain' | 'application/json';
  /** When the device ran the query, as the query response reported it. */
  timestamp: string;
  runtime: number;
}

/** A share as `GET /api/share/{id}` returns it. */
export interface Snapshot {
  id: string;
  version: number;
  createdAt: string;
  expiresAt: string;
  results: SharedResult[];
}

/** What loading a share gave. */
export type ShareOutcome =
  | { status: 'found'; snapshot: Snapshot }
  | { status: 'notFound' | 'unsupported' | 'rateLimited' | 'error' };

/** The version of the snapshot format this version reads (`SNAPSHOT_VERSION` in S1). */
const SNAPSHOT_VERSION = 1;

/**
 * The value of the address's `share` parameter (the first, if there are several), or
 * `null` when it has none. An empty value is `''`: a share link, but not a valid one.
 */
export function shareParam(search: string): string | null {
  return new URLSearchParams(search).get(SHARE_PARAM);
}

/** Whether `value` is a share id, which is all the page ever puts in a request. */
export function isShareId(value: string): boolean {
  return SHARE_ID.test(value);
}

/**
 * The query string without its `share` parameters, keeping the others as they were
 * written: `''` or a string that starts with `?`.
 */
export function withoutShare(search: string): string {
  const parts = search.replace(/^\?/, '').split('&');
  const keep = parts.filter(part => {
    const [key] = Array.from(new URLSearchParams(part).keys());
    return key !== undefined && key !== SHARE_PARAM;
  });
  if (keep.length === parts.filter(part => part !== '').length) {
    return search;
  }
  return keep.length === 0 ? '' : `?${keep.join('&')}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every(v => typeof v === 'string');
}

function isTarget(value: unknown): value is string | string[] {
  return (
    typeof value === 'string' || (Array.isArray(value) && value.every(v => typeof v === 'string'))
  );
}

function isSharedResult(value: unknown): value is SharedResult {
  if (!isObject(value) || !isObject(value.query) || !isObject(value.labels)) {
    return false;
  }
  const { query, labels } = value;
  return (
    typeof query.location === 'string' &&
    typeof query.queryType === 'string' &&
    typeof query.queryTypeName === 'string' &&
    isTarget(query.target) &&
    isStringRecord(query.variables) &&
    typeof labels.location === 'string' &&
    typeof labels.queryType === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.runtime === 'number' &&
    // The output the result view renders, as for a saved history entry.
    isRenderableResponse({ level: 'success', format: value.format, output: value.output })
  );
}

/**
 * Whether a response has the shape of a snapshot this page can show. The server checks
 * every snapshot before it returns it; this keeps a response from something else (a
 * proxy, another version) from breaking the page.
 */
export function isSnapshot(value: unknown): value is Snapshot {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.expiresAt === 'string' &&
    Array.isArray(value.results) &&
    value.results.length > 0 &&
    value.results.every(isSharedResult)
  );
}

/**
 * Load share `id` with one `GET /api/share/{id}`. Only the status is read from an error
 * response: the page shows its own configured text, never the response's.
 */
export async function fetchShare(id: string, timeout: number): Promise<ShareOutcome> {
  if (!isShareId(id)) {
    return { status: 'notFound' };
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `/api/share/${id}`,
      { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' },
      timeout,
    );
  } catch {
    return { status: 'error' };
  }
  if (response.status === 404) {
    return { status: 'notFound' };
  }
  if (response.status === 422) {
    return { status: 'unsupported' };
  }
  if (response.status === 429) {
    return { status: 'rateLimited' };
  }
  if (!response.ok) {
    return { status: 'error' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'error' };
  }
  if (isObject(body) && typeof body.version === 'number' && body.version !== SNAPSHOT_VERSION) {
    return { status: 'unsupported' };
  }
  if (!isSnapshot(body) || body.id !== id) {
    return { status: 'error' };
  }
  return { status: 'found', snapshot: body };
}

/**
 * Share `id`, loaded once: no retry, no refetch. An id that isn't one is not found,
 * without a request.
 */
export function useShareSnapshot(id: string): ShareOutcome | { status: 'loading' } {
  const { requestTimeout } = useConfig();
  const valid = isShareId(id);
  const { data, isError } = useQuery<ShareOutcome>({
    queryKey: ['/api/share', id],
    queryFn: () => fetchShare(id, requestTimeout * 1000),
    enabled: valid,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    staleTime: Number.POSITIVE_INFINITY,
    cacheTime: 0,
  });
  if (!valid) {
    return { status: 'notFound' };
  }
  if (isError) {
    return { status: 'error' };
  }
  return data ?? { status: 'loading' };
}

/**
 * A shared query in the form history reuse hands to the form (`useHistoryView.prefill`),
 * with the locations' names when it was shared.
 */
export function shareQuery(snapshot: Snapshot): { query: HistoryQuery; locations: string[] } {
  const [first] = snapshot.results;
  const { target } = first.query;
  return {
    query: {
      queryLocation: snapshot.results.map(r => r.query.location),
      queryType: first.query.queryType,
      queryTypeName: first.query.queryTypeName,
      queryTarget: Array.isArray(target) ? target : [target],
      queryVariables: first.query.variables,
    },
    locations: snapshot.results.map(r => r.labels.location),
  };
}

interface ShareViewState {
  /**
   * The `share` parameter the page was opened with, while its shared result shows in
   * place of the form; `null` otherwise. It may not be a valid id.
   */
  id: string | null;
  open(id: string): void;
  close(): void;
}

/** Whether a shared result shows, and which. */
export const useShareView = create<ShareViewState>()(
  withDev<ShareViewState>(
    set => ({
      id: null,
      open(id: string): void {
        set({ id });
      },
      close(): void {
        set({ id: null });
      },
    }),
    'useShareView',
  ),
);
