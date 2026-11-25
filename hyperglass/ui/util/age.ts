import dayjs from 'dayjs';
import relativeTimePlugin from 'dayjs/plugin/relativeTime';
import utcPlugin from 'dayjs/plugin/utc';

dayjs.extend(relativeTimePlugin);
dayjs.extend(utcPlugin);

/**
 * The time a route was learned: weekday, date and a 24-hour time, in UTC, so it reads
 * the same way in every locale (`Wed, Nov 4, 2026, 08:05:09 UTC` in English).
 */
const ABSOLUTE: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
  timeZoneName: 'short',
};

export interface FormattedAge {
  /** The age without a suffix, such as `2 hours`. */
  relative: string;
  /** The time `inSeconds` ago, in UTC. */
  absolute: string;
}

/**
 * Format a route's age of `inSeconds` in `locale`, which falls back to English (not the
 * browser's locale) when it isn't known. `dayjsLocale` is the dayjs locale loaded for
 * `locale` (see `useDayjsLocale`), which the relative age is written in.
 */
export function formatAge(inSeconds: number, locale: string, dayjsLocale: string): FormattedAge {
  const now = dayjs.utc().locale(dayjsLocale);
  const then = now.subtract(inSeconds, 'second');
  return {
    relative: now.to(then, true),
    absolute: new Intl.DateTimeFormat([locale, 'en'], ABSOLUTE).format(then.toDate()),
  };
}
