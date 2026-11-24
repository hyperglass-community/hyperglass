export interface FormatTimestampOptions {
  /** BCP 47 locale(s). Defaults to the viewer's locale. */
  locale?: string | string[];
  /** IANA time zone. Defaults to the viewer's time zone. */
  timeZone?: string;
}

// The backend's `YYYY-MM-DD HH:MM:SS`, or ISO 8601 with `T`, an optional fraction and an
// optional `Z` or `±HH:MM` offset. Nothing else is treated as a timestamp.
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):?(\d{2}))?$/;

/** Parse a backend or ISO 8601 timestamp. A value without a zone is UTC. */
function parseTimestamp(value: string): Date | null {
  const match = TIMESTAMP.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number((match[7] ?? '').slice(0, 3).padEnd(3, '0'));
  const sign = match[8] === '-' ? -1 : 1;
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);

  // `Date.UTC` rolls out-of-range fields over (month 13, day 45 or 30 February); reject them.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const offset = sign * (offsetHour * 60 + offsetMinute) * 60_000;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset);
}

/**
 * Show a backend timestamp in the viewer's locale and time zone.
 *
 * The backend sends naive UTC values such as `2026-11-20 08:00:00` (see `Query.timestamp`).
 * `new Date()` would read those as local time, so they are parsed as UTC. A value that
 * carries its own zone (`Z` or `+02:00`) keeps it.
 *
 * The locale decides the layout and the 12- or 24-hour clock. The long time style includes
 * the zone name or offset, so a local time can't be mistaken for UTC. Anything that isn't
 * a timestamp in one of those forms is returned unchanged. Epoch numbers aren't accepted,
 * since nothing sends them yet.
 */
export function formatTimestamp(value: string, options: FormatTimestampOptions = {}): string {
  const parsed = parseTimestamp(value);
  if (parsed === null) {
    return value;
  }
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(parsed);
}
