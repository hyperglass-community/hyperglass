import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimestamp } from './timestamp';

// Every case passes an explicit locale and display time zone, so the result does not
// depend on the runner's locale. The process time zone is pinned to one that isn't UTC
// (UTC+5:30), so reading a naive value as local time instead of UTC gives a different
// hour even on a runner that is set to UTC.
const toronto = { locale: 'en-US', timeZone: 'America/Toronto' };

type Target = { locale: string; timeZone: string };

// The exact text comes from the CLDR data that ships with the runtime, so most cases
// compare against `Intl` output for a known instant instead of a hard-coded string.
function format(instant: number, { locale, timeZone }: Target): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(instant));
}

/** The numeric date and time fields of an instant in a time zone. */
function fields(instant: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  return Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]),
  );
}

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('formats a known value (smoke check against the bundled CLDR data)', () => {
    expect(formatTimestamp('2026-11-20 08:00:00', toronto)).toBe('Nov 20, 2026, 3:00:00 AM EST');
  });

  it("parses the backend's space-separated naive value as UTC", () => {
    const instant = Date.UTC(2026, 10, 20, 8, 0, 0);
    expect(formatTimestamp('2026-11-20 08:00:00', toronto)).toBe(format(instant, toronto));
  });

  it('parses an ISO value without a zone designator as UTC', () => {
    const instant = Date.UTC(2026, 6, 1, 14, 45, 37);
    expect(formatTimestamp('2026-07-01T14:45:37', toronto)).toBe(format(instant, toronto));
  });

  it('keeps an explicit zone designator', () => {
    const eightUtc = Date.UTC(2026, 10, 20, 8, 0, 0);
    expect(formatTimestamp('2026-11-20T08:00:00Z', toronto)).toBe(format(eightUtc, toronto));
    expect(formatTimestamp('2026-11-20T10:00:00+02:00', toronto)).toBe(format(eightUtc, toronto));
    expect(formatTimestamp('2026-11-20T08:00:00.123456-05:30', toronto)).toBe(
      format(Date.UTC(2026, 10, 20, 13, 30, 0), toronto),
    );
  });

  it("shows the time in the viewer's time zone", () => {
    const instant = Date.UTC(2026, 11, 31, 20, 30, 0);
    const tokyo = { locale: 'en-US', timeZone: 'Asia/Tokyo' };
    // The instant falls on another day and year in Tokyo, so a result that ignored the
    // time zone could not match.
    expect(fields(instant, 'Asia/Tokyo')).toMatchObject({ year: '2027', day: '1', hour: '05' });
    expect(fields(instant, 'UTC')).toMatchObject({ year: '2026', day: '31', hour: '20' });

    const shown = formatTimestamp('2026-12-31 20:30:00', tokyo);
    expect(shown).toBe(format(instant, tokyo));
    expect(shown).not.toBe(format(instant, { locale: 'en-US', timeZone: 'UTC' }));
    expect(shown).not.toBe(format(instant, toronto));
  });

  it('lets the locale choose the layout and the 12- or 24-hour clock', () => {
    // Midnight in Toronto: `en-US` uses a 12-hour clock, `en-GB` and `de-DE` 24-hour ones.
    const midnight = Date.UTC(2026, 10, 20, 5, 0, 0);
    const london = { locale: 'en-GB', timeZone: 'America/Toronto' };
    const berlin = { locale: 'de-DE', timeZone: 'Europe/Berlin' };
    expect(formatTimestamp('2026-11-20 05:00:00', toronto)).toBe(format(midnight, toronto));
    expect(formatTimestamp('2026-11-20 05:00:00', london)).toBe(format(midnight, london));
    expect(formatTimestamp('2026-11-20 05:00:00', berlin)).toBe(format(midnight, berlin));
    expect(format(midnight, toronto)).not.toBe(format(midnight, london));
  });

  it.each([
    'not-a-date',
    '',
    '12',
    'abc 2026',
    '2026-13-45 99:99:99',
    '2026-02-30 00:00:00',
    '2026-11-20 24:00:00',
    '2026-11-20 08:00:00+25:00',
    '2026-11-20',
  ])('returns %j unchanged because it is not a timestamp', value => {
    expect(formatTimestamp(value, toronto)).toBe(value);
  });
});
