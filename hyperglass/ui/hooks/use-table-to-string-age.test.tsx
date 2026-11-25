import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig } from '~/__tests__/render';
import { HyperglassContext } from '~/context';
import { useTableToString } from './use-table-to-string';

import type { Config } from '~/types';

// 2026-11-24 10:00:00 UTC; the route was learned two hours before.
const NOW = Date.UTC(2026, 10, 24, 10, 0, 0);
const TWO_HOURS = 2 * 60 * 60;

const data = {
  timestamp: '2026-11-24 10:00:00',
  output: {
    vrf: 'default',
    count: 1,
    routes: [{ prefix: '192.0.2.0/24', active: true, age: TWO_HOURS }],
    winning_weight: 'high',
  },
} as unknown as QueryResponse;

/** Render the hook with `config` and return its copy function. */
function copied(config: Config): () => string {
  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <HyperglassContext.Provider value={config}>{children}</HyperglassContext.Provider>
  );
  const { result } = renderHook(() => useTableToString(['192.0.2.0/24'], data), { wrapper });
  return () => result.current();
}

describe('useTableToString age', () => {
  beforeEach(() => {
    // Only `Date` is faked. The process time zone isn't UTC, so a time shown in it fails.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('TZ', 'Asia/Kolkata');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const fields = [
    ['Prefix', 'prefix', 'left'],
    ['Age', 'age', 'right'],
  ] as Config['parsedDataFields'];

  it('copies the age and its time in English by default, like the table (#605)', () => {
    const copy = copied(makeConfig({ parsedDataFields: fields }));

    expect(copy()).toContain('- Age: 2 hours (Tue, Nov 24, 2026, 08:00:00 UTC)');
  });

  it('copies the age and its time in web.locale, like the table (#605)', async () => {
    const copy = copied(makeConfig({ parsedDataFields: fields, web: { locale: 'fr' } }));

    await waitFor(() =>
      expect(copy()).toContain('- Age: 2 heures (mar. 24 nov. 2026, 08:00:00 UTC)'),
    );
  });
});
