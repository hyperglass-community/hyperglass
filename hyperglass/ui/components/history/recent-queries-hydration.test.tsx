import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, within } from '@testing-library/react';
// @ts-expect-error: the UI has no `@types/react-dom`, so `react-dom/server` is untyped.
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testConfig } from '~/__tests__/render';
import { makeTheme } from '~/util';

import type { HistoryEntry } from '~/hooks';

// The UI is a static export: the landing page is prerendered when the UI is built, with
// no history, and hydrated in a browser that has some. These tests hydrate prerendered
// markup as the browser does; a plain `render()` can't catch a mismatch.

const STORAGE_KEY = 'hyperglass.history';

function entry(id: string, target: string): HistoryEntry {
  return {
    id,
    savedAt: Date.parse('2026-11-21T10:00:00Z'),
    query: {
      queryLocation: ['router_one'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTypeName: 'BGP Route',
      queryTarget: [target],
      queryVariables: {},
    },
    labels: { locations: ['Router One'], type: 'BGP Route', target, variables: [] },
    results: {
      router_one: {
        name: 'Router One',
        queryId: id,
        data: {
          id,
          random: 'r4nd0m',
          cached: false,
          runtime: 2,
          level: 'success',
          timestamp: '2026-11-21 10:00:00',
          keywords: [],
          output: 'show route',
          format: 'text/plain',
          enrichment: 'complete',
        },
      },
    },
  };
}

/** Prerender `RecentQueries` with the build's empty storage, as `next build` does. */
async function prerender(): Promise<string> {
  const { HyperglassContext } = await import('~/context');
  const { RecentQueries } = await import('./recent-queries');
  const theme = makeTheme(testConfig.web.theme, testConfig.web.theme.defaultColorMode);
  // Chakra's `useLayoutEffect` calls warn when rendered on the server; silence them.
  const serverWarnings = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const html = renderToString(
    <HyperglassContext.Provider value={testConfig}>
      <ChakraProvider theme={theme}>
        <RecentQueries />
      </ChakraProvider>
    </HyperglassContext.Provider>,
  );
  serverWarnings.mockRestore();
  return html;
}

/** Hydrate `html` with fresh modules, which read the browser's stored history. */
async function hydrate(html: string) {
  vi.resetModules();
  const { HyperglassContext } = await import('~/context');
  const { RecentQueries } = await import('./recent-queries');
  const theme = makeTheme(testConfig.web.theme, testConfig.web.theme.defaultColorMode);
  const tree = (
    <HyperglassContext.Provider value={testConfig}>
      <ChakraProvider theme={theme}>
        <RecentQueries />
      </ChakraProvider>
    </HyperglassContext.Provider>
  );
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  render(tree, { container, hydrate: true });
}

let errors: { mock: { calls: unknown[][] } };

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('RecentQueries after hydration', () => {
  it('hydrates the prerendered page without a mismatch, then lists the stored queries', async () => {
    const html = await prerender();
    expect(html).not.toContain('2001:db8::/32');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { entries: [entry('v6', '2001:db8::/32'), entry('v4', '192.0.2.0/24')] },
        version: 1,
      }),
    );
    errors = vi.spyOn(console, 'error');

    await hydrate(html);

    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2001:db8::/32');
    expect(rows[1]).toHaveTextContent('192.0.2.0/24');
    // React reports a mismatch with `console.error` (a warning, or a recoverable error).
    const messages = errors.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(messages.filter((m: string) => /hydrat|did not match|server/i.test(m))).toEqual([]);
  });

  it('hydrates without a mismatch when nothing is stored', async () => {
    const html = await prerender();
    errors = vi.spyOn(console, 'error');

    await hydrate(html);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(errors.mock.calls).toEqual([]);
  });
});
