import dayjs from 'dayjs';
import utcPlugin from 'dayjs/plugin/utc';

dayjs.extend(utcPlugin);

export interface FormatTimestampOptions {
  /** BCP 47 locale(s). Defaults to the viewer's locale. */
  locale?: string | string[];
  /** IANA time zone. Defaults to the viewer's time zone. */
  timeZone?: string;
}

/**
 * Show a backend timestamp in the viewer's locale and time zone.
 *
 * The backend sends naive UTC values such as `2026-11-20 08:00:00` (see `Query.timestamp`).
 * `new Date()` would read those as local time, so parse them as UTC first. A value that
 * carries its own zone (`Z` or `+02:00`) keeps it.
 *
 * The clock is always 24-hour and the time zone name is included, so the result reads the
 * same way whatever the locale's 12-hour convention, and a viewer comparing it with a
 * router's log can tell which zone it is in. Unparseable input is returned unchanged.
 */
export function formatTimestamp(value: string, options: FormatTimestampOptions = {}): string {
  const parsed = dayjs.utc(value);
  if (!parsed.isValid()) {
    return value;
  }
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(parsed.toDate());
}
