import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, renderWithProviders, testConfig } from '~/__tests__/render';
import { Layout } from '~/components/layout';
import { useShareView } from '~/hooks';
import Index from '../../pages/index';

// A shared result that passes the shape check but still fails to render must not take
// the page down (#560 review): the shared view shows its error text instead.
vi.mock('~/components', async importOriginal => ({
  ...(await importOriginal<typeof import('~/components')>()),
  Debugger: () => null,
  Footer: () => null,
  Greeting: () => null,
  Header: () => null,
  ReadOnlyResult: () => {
    throw new TypeError("Cannot read properties of undefined (reading 'map')");
  },
}));

const router = vi.hoisted(() => ({
  isReady: true,
  pathname: '/',
  replace: vi.fn(async (url: string, as?: string) => {
    window.history.replaceState(window.history.state, '', as ?? url);
    return true;
  }),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));

const ID = '0123456789abcdef0123456789abcdef';
const { text } = testConfig.web;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: ID,
        version: 1,
        createdAt: '2026-11-20T08:05:00Z',
        expiresAt: '2026-12-20T08:05:00Z',
        results: [
          {
            query: {
              location: 'router_one',
              queryType: '__hyperglass_juniper_bgp_route__',
              queryTypeName: 'BGP Route',
              target: '192.0.2.0/24',
              variables: {},
            },
            labels: { location: 'Router One', queryType: 'BGP Route' },
            output: 'output',
            format: 'text/plain',
            timestamp: '2026-11-20 08:00:00',
            runtime: 1,
          },
        ],
      }),
    })),
  );
});

afterEach(() => {
  useShareView.setState({ id: null });
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Shared result page, a result that fails to render', () => {
  it('shows the error text in place of the results and keeps the page', async () => {
    window.history.replaceState(null, '', `/?share=${ID}`);
    renderWithProviders(
      <Layout>
        <Index />
      </Layout>,
    );

    const section = await screen.findByRole('region', { name: text.shareTitle }, IMPORT_WAIT);
    expect(await within(section).findByRole('alert')).toHaveTextContent(text.shareError);
    expect(screen.queryByText(/reading 'map'/)).not.toBeInTheDocument();

    await userEvent.click(within(section).getByRole('button', { name: text.shareNewQuery }));
    expect(await screen.findAllByText('Router One', undefined, IMPORT_WAIT)).not.toHaveLength(0);
  });
});
