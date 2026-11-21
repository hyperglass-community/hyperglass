import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimestamp } from './timestamp';

// Every case passes an explicit locale and display time zone, so the result does not
// depend on the runner's locale. The process time zone is pinned to one that isn't UTC
// (UTC+5:30), so reading a naive value as local time instead of UTC gives a different
// hour even on a runner that is set to UTC.
const toronto = { locale: 'en-US', timeZone: 'America/Toronto' };

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses the backend's space-separated naive value as UTC", () => {
    expect(formatTimestamp('2026-11-20 08:00:00', toronto)).toBe('Nov 20, 2026, 3:00:00 AM EST');
  });

  it('parses an ISO value without a zone designator as UTC', () => {
    expect(formatTimestamp('2026-07-01T14:45:37', toronto)).toBe('Jul 1, 2026, 10:45:37 AM EDT');
  });

  it('keeps an explicit zone designator', () => {
    expect(formatTimestamp('2026-11-20T08:00:00Z', toronto)).toBe('Nov 20, 2026, 3:00:00 AM EST');
    expect(formatTimestamp('2026-11-20T10:00:00+02:00', toronto)).toBe(
      'Nov 20, 2026, 3:00:00 AM EST',
    );
    expect(formatTimestamp('2026-11-20T08:00:00.123456-05:30', toronto)).toBe(
      'Nov 20, 2026, 8:30:00 AM EST',
    );
  });

  it('converts across the date line and shows an offset where there is no zone name', () => {
    expect(
      formatTimestamp('2026-11-20 20:30:00', { locale: 'en-US', timeZone: 'Asia/Tokyo' }),
    ).toBe('Nov 21, 2026, 5:30:00 AM GMT+9');
  });

  it('lets the locale choose the 12- or 24-hour clock', () => {
    // Midnight in Toronto: `en-US` uses a 12-hour clock, `en-GB` a 24-hour one.
    expect(formatTimestamp('2026-11-20 05:00:00', toronto)).toBe('Nov 20, 2026, 12:00:00 AM EST');
    expect(
      formatTimestamp('2026-11-20 05:00:00', { locale: 'en-GB', timeZone: 'America/Toronto' }),
    ).toBe('20 Nov 2026, 00:00:00 GMT-5');
    expect(
      formatTimestamp('2026-11-20 08:00:00', { locale: 'de-DE', timeZone: 'Europe/Berlin' }),
    ).toBe('20.11.2026, 09:00:00 MEZ');
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
