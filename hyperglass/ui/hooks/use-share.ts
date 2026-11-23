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

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/**
 * An ASN as text: digits only. The tables and the AS path look ASNs up in
 * `asn_organizations`, where a name an object already has (`__proto__`, `constructor`)
 * would reach Object's own members.
 */
const isAsnText = (value: unknown): boolean => isString(value) && /^\d{1,10}$/.test(value);

/** A traceroute hop's ASN as the server writes it: digits, `IXP`, `None`, or `null`. */
const isHopAsn = (value: unknown): boolean =>
  value === null || value === undefined || value === 'IXP' || value === 'None' || isAsnText(value);

/** `value` passes `check`, or is `null` or absent: a field the tables show as blank. */
function orNull(check: (value: unknown) => boolean): (value: unknown) => boolean {
  return value => value === null || value === undefined || check(value);
}

/** Whether `value` is an object whose listed fields each pass their check. */
function hasFields(value: unknown, fields: Record<string, (v: unknown) => boolean>): boolean {
  return isObject(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
}

/** The fields of a BGP route the table and the copied text read (`Route`, `cell.tsx`). */
const ROUTE_FIELDS: Record<string, (v: unknown) => boolean> = {
  prefix: isString,
  active: isBoolean,
  age: isNumber,
  weight: isNumber,
  med: isNumber,
  local_preference: isNumber,
  as_path: v => Array.isArray(v) && v.every(isInteger),
  communities: v => Array.isArray(v) && v.every(isString),
  next_hop: isString,
  source_as: isInteger,
  source_rid: isString,
  peer_rid: isString,
  // An index into the RPKI icons and colours.
  rpki_state: v => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3,
  filtered: orNull(isBoolean),
  // The server writes it as `AS<number>` (`BGPRouteTable` enrichment).
  next_hop_asn: orNull(v => isString(v) && /^AS\d{1,10}$/.test(v)),
  next_hop_org: orNull(isString),
  next_hop_country: orNull(isString),
};

const NULLABLE_NUMBER = orNull(isNumber);
const NULLABLE_STRING = orNull(isString);

/** The fields of a traceroute hop the table and the copied text read (`TracerouteHop`). */
const HOP_FIELDS: Record<string, (v: unknown) => boolean> = {
  hop_number: isNumber,
  ip_address: NULLABLE_STRING,
  display_ip: NULLABLE_STRING,
  hostname: NULLABLE_STRING,
  rtt1: NULLABLE_NUMBER,
  rtt2: NULLABLE_NUMBER,
  rtt3: NULLABLE_NUMBER,
  loss_pct: NULLABLE_NUMBER,
  sent_count: NULLABLE_NUMBER,
  last_rtt: NULLABLE_NUMBER,
  avg_rtt: NULLABLE_NUMBER,
  best_rtt: NULLABLE_NUMBER,
  worst_rtt: NULLABLE_NUMBER,
  asn: isHopAsn,
  org: NULLABLE_STRING,
  prefix: NULLABLE_STRING,
  country: NULLABLE_STRING,
  rir: NULLABLE_STRING,
  allocated: NULLABLE_STRING,
};

/** AS names by ASN, as the AS path and the tables read them. */
const isAsnOrganizations = orNull(
  v =>
    isObject(v) &&
    Object.entries(v).every(
      ([asn, org]) =>
        isAsnText(asn) && hasFields(org, { name: NULLABLE_STRING, country: NULLABLE_STRING }),
    ),
);

/**
 * Whether structured output has every field the BGP or traceroute table reads, with its
 * type: a value of another type (an object where text is expected) would crash the table,
 * and with it the page.
 */
function isRenderableStructured(output: unknown): boolean {
  if (!isObject(output) || !isAsnOrganizations(output.asn_organizations)) {
    return false;
  }
  if (Array.isArray(output.routes)) {
    return (
      orNull(v => v === 'high' || v === 'low')(output.winning_weight) &&
      output.routes.every(route => hasFields(route, ROUTE_FIELDS))
    );
  }
  if (Array.isArray(output.hops)) {
    return output.hops.every(hop => hasFields(hop, HOP_FIELDS));
  }
  return false;
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
    isRenderableResponse({ level: 'success', format: value.format, output: value.output }) &&
    (value.format !== 'application/json' || isRenderableStructured(value.output))
  );
}

/**
 * Whether a response has the shape of a snapshot this page can show: S1's fields, and
 * output with the fields and types the result view reads. The server checks the snapshot's
 * own fields, not the structured output inside it, and a response can also come from
 * something else (a proxy, another version). Values the tables don't read are not checked,
 * so this is not a full schema check; `SharedResult` also renders the results inside an
 * error boundary.
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
