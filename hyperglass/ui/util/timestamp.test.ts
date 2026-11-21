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
    expect(formatTimestamp('2026-11-20 08:00:00', toronto)).toBe('Nov 20, 2026, 03:00:00 EST');
  });

  it('parses an ISO value without a zone designator as UTC', () => {
    expect(formatTimestamp('2026-07-01T14:45:37', toronto)).toBe('Jul 1, 2026, 10:45:37 EDT');
  });

  it('keeps an explicit zone designator', () => {
    expect(formatTimestamp('2026-11-20T08:00:00Z', toronto)).toBe('Nov 20, 2026, 03:00:00 EST');
    expect(formatTimestamp('2026-11-20T10:00:00+02:00', toronto)).toBe(
      'Nov 20, 2026, 03:00:00 EST',
    );
  });

  it('converts across the date line', () => {
    expect(
      formatTimestamp('2026-11-20 20:30:00', { locale: 'en-US', timeZone: 'Asia/Tokyo' }),
    ).toBe('Nov 21, 2026, 05:30:00 GMT+9');
  });

  it('uses a 24-hour clock even where the locale prefers 12 hours', () => {
    expect(formatTimestamp('2026-11-20 23:30:00', { locale: 'en-US', timeZone: 'UTC' })).toBe(
      'Nov 20, 2026, 23:30:00 UTC',
    );
    // Midnight is 00, not 24 (the `h24` cycle) or 12 (`h12`).
    expect(formatTimestamp('2026-11-20 05:00:00', toronto)).toBe('Nov 20, 2026, 00:00:00 EST');
  });

  it("follows the viewer's locale for the date layout", () => {
    expect(
      formatTimestamp('2026-11-20 08:00:00', { locale: 'de-DE', timeZone: 'Europe/Berlin' }),
    ).toBe('20. Nov. 2026, 09:00:00 MEZ');
  });

  it('returns the original value when it cannot be parsed', () => {
    expect(formatTimestamp('not-a-date', toronto)).toBe('not-a-date');
    expect(formatTimestamp('', toronto)).toBe('');
  });
});
