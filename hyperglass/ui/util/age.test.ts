import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAge } from './age';

describe('formatAge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 4, 8, 5, 9) + 90 * 60 * 1000);
    vi.stubEnv('TZ', 'America/Toronto');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('shows the age and a 24-hour UTC time with the weekday (#605)', () => {
    expect(formatAge(90 * 60, 'en', 'en')).toEqual({
      relative: '2 hours',
      absolute: 'Wed, Nov 4, 2026, 08:05:09 UTC',
    });
  });

  it('keeps the 24-hour clock in a locale that uses 12 hours (#605)', () => {
    expect(formatAge(90 * 60, 'en-US', 'en').absolute).toBe('Wed, Nov 4, 2026, 08:05:09 UTC');
  });

  it('asks for English after the configured locale, not the browser default (#605)', () => {
    const format = vi.spyOn(Intl, 'DateTimeFormat');

    formatAge(60, 'qq', 'en');

    expect(format).toHaveBeenCalledWith(['qq', 'en'], expect.objectContaining({ timeZone: 'UTC' }));
  });
});
