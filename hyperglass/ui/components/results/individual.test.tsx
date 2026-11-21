import { Accordion } from '@chakra-ui/react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BiError } from 'react-icons/bi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { useFormState } from '~/hooks';
import { Result } from './individual';

import type { Config } from '~/types';

// `Result` runs its own query through `useLGQuery`, which POSTs to `/api/query` with
// `fetch`. Each test replaces `fetch` with a stub that answers like the backend does.

const initialFormState = useFormState.getState();

const form = {
  queryLocation: ['router_one'],
  queryTarget: ['192.0.2.0/24'],
  queryType: '__hyperglass_juniper_bgp_route__',
  queryVariables: {},
};

function response(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    id: 'c0ffee',
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-20 08:00:00',
    keywords: [],
    output: 'show route 192.0.2.0/24\n192.0.2.0/24 *[BGP/170] via 198.51.100.1',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

const route: Route = {
  prefix: '192.0.2.0/24',
  active: true,
  age: 3600,
  weight: 170,
  med: 0,
  local_preference: 100,
  as_path: [65001, 64496],
  communities: ['65001:100'],
  next_hop: '198.51.100.1',
  source_as: 64496,
  source_rid: '198.51.100.1',
  peer_rid: '198.51.100.1',
  rpki_state: 1,
  filtered: false,
};

const bgpOutput: StructuredResponse = {
  vrf: 'default',
  count: 1,
  routes: [route],
  winning_weight: 'low',
};

const hop = (hop_number: number, ip: string): TracerouteHop => ({
  hop_number,
  ip_address: ip,
  display_ip: ip,
  hostname: null,
  rtt1: 1.1,
  rtt2: 1.2,
  rtt3: 1.3,
  loss_pct: null,
  sent_count: null,
  last_rtt: null,
  avg_rtt: null,
  best_rtt: null,
  worst_rtt: null,
  asn: null,
  org: null,
  prefix: null,
  country: null,
  rir: null,
  allocated: null,
});

const tracerouteOutput: TracerouteStructuredOutput = {
  vrf: 'default',
  target: '2001:db8::1',
  source: '2001:db8:ffff::1',
  hops: [hop(1, '2001:db8:1::1'), hop(2, '2001:db8:2::1')],
  max_hops: 30,
  packet_size: 60,
  raw_output: null,
};

/** A `fetch` stub that answers every request with `body` as JSON. */
function answer(body: unknown) {
  return vi.fn(async () => ({ json: async () => body, statusText: 'OK' }) as Response);
}

function stubFetch(impl: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
  vi.stubGlobal('fetch', impl);
  return impl;
}

interface RenderOptions {
  queryLocation?: string;
  config?: Config;
}

function renderResult({ queryLocation = 'router_one', config }: RenderOptions = {}) {
  return renderWithProviders(
    <Accordion allowMultiple>
      <Result index={0} queryLocation={queryLocation} />
    </Accordion>,
    { config },
  );
}

/** The header's accordion button, which also signals when the query has settled. */
function header(): HTMLElement {
  return screen.getByRole('button', { name: /Router One/ });
}

/**
 * The status icon in the header. The header also holds Chakra's accordion chevron, an
 * `svg` that is there from the first render, so select the status icon by excluding it.
 */
function statusIcon(): Element | null {
  return header().querySelector('svg:not(.chakra-accordion__icon)');
}

/** Wait until the result is expanded, which `Result` does once its query settles. */
async function settled(): Promise<void> {
  await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'true'), IMPORT_WAIT);
  // The status icon loads through `next/dynamic`; wait for it so coverage is stable.
  await waitFor(() => expect(statusIcon()).toBeInTheDocument(), IMPORT_WAIT);
}

/** The drawing of the header's status icon, to tell the error icon from the success icon. */
function statusIconPath(): string | null | undefined {
  return statusIcon()?.querySelector('path')?.getAttribute('d');
}

/** The drawing of the error icon the header shows for a failed query. */
function errorIconPath(): string | null | undefined {
  const { container } = render(<BiError />);
  return container.querySelector('path')?.getAttribute('d');
}

/**
 * The optional AS path button, then the copy and requery buttons: the buttons next to the
 * accordion header, not those inside the result.
 */
function actionButtons(): HTMLElement[] {
  const row = header().parentElement;
  if (row === null) {
    throw new Error('The result header has no parent element');
  }
  return Array.from(row.querySelectorAll<HTMLElement>('.chakra-button'));
}

beforeEach(() => {
  // framer-motion measures layout with `window.scrollTo`, which jsdom does not implement.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  useFormState.setState({ ...initialFormState, form, status: 'results' }, true);
  // Silence the `console.error` calls `Result` makes for every non-success response.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  useFormState.setState(initialFormState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Result', () => {
  describe('text output', () => {
    it('sends the form values for its location to the query API', async () => {
      const fetch = stubFetch(answer(response()));
      renderResult();
      await settled();

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/query');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        queryLocation: 'router_one',
        queryTarget: ['192.0.2.0/24'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryVariables: {},
      });
    });

    it('shows the device name and the output, and stores the response', async () => {
      const data = response();
      stubFetch(answer(data));
      const { container } = renderResult();
      await settled();

      expect(header()).toHaveTextContent('Router One');
      expect(container.querySelector('pre')).toHaveTextContent(
        '192.0.2.0/24 *[BGP/170] via 198.51.100.1',
      );
      expect(useFormState.getState().responses).toEqual({ router_one: data });
      expect(console.error).not.toHaveBeenCalled();
    });

    it('shows the run time in the status tooltip', async () => {
      stubFetch(answer(response({ runtime: 1 })));
      renderResult();
      await settled();

      expect(statusIconPath()).not.toBe(errorIconPath());
      await userEvent.hover(statusIcon() as Element);

      expect(
        await screen.findByRole('tooltip', { name: 'Completed in 1 second' }, IMPORT_WAIT),
      ).toBeInTheDocument();
    });
  });

  describe('structured output', () => {
    it('renders a BGP route table and the AS path button', async () => {
      stubFetch(answer(response({ format: 'application/json', output: bgpOutput })));
      const { container } = renderResult();
      await settled();

      const table = await screen.findByRole('table', { hidden: true });
      expect(within(table).getByText('Prefix')).toBeInTheDocument();
      expect(within(table).getByText('192.0.2.0/24')).toBeInTheDocument();
      expect(container.querySelector('pre')).not.toBeInTheDocument();
      // AS path, copy and requery.
      expect(actionButtons()).toHaveLength(3);
      await userEvent.hover(actionButtons()[0]);
      expect(
        await screen.findByRole('tooltip', { name: 'View AS Path' }, IMPORT_WAIT),
      ).toBeInTheDocument();
    });

    it('renders a traceroute table and the AS path button', async () => {
      stubFetch(answer(response({ format: 'application/json', output: tracerouteOutput })));
      renderResult();
      await settled();

      const table = await screen.findByRole('table', { hidden: true });
      expect(within(table).getByText('2001:db8:1::1')).toBeInTheDocument();
      expect(within(table).getByText('2001:db8:2::1')).toBeInTheDocument();
      // Any structured output gets the AS path button, then copy and requery.
      expect(actionButtons()).toHaveLength(3);
    });

    it('shows structured output sent as plain text as an error', async () => {
      // The table components only render `application/json` responses.
      stubFetch(answer(response({ format: 'text/plain', output: bgpOutput })));
      renderResult();
      await settled();

      expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
      expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
        testConfig.messages.general,
      );
    });
  });

  describe('errors', () => {
    it('shows an error response with its keywords in bold', async () => {
      const output = '192.0.2.0/24 is not allowed.';
      stubFetch(answer(response({ level: 'error', output, keywords: ['192.0.2.0/24'] })));
      renderResult();
      await settled();

      const alert = screen.getByRole('alert', { hidden: true });
      expect(alert).toHaveTextContent(output);
      expect(alert).toHaveAttribute('data-status', 'error');
      expect(within(alert).getByText('192.0.2.0/24').tagName).toBe('STRONG');
      expect(screen.queryByText(testConfig.web.text.cachePrefix)).not.toBeInTheDocument();
    });

    it('shows the configured message for an empty result as a warning', async () => {
      // The backend answers an empty result with `messages.noOutput` at the warning level.
      stubFetch(answer(response({ level: 'warning', output: testConfig.messages.noOutput })));
      renderResult();
      await settled();

      const alert = screen.getByRole('alert', { hidden: true });
      expect(alert).toHaveTextContent(testConfig.messages.noOutput);
      expect(alert).toHaveAttribute('data-status', 'warning');
      // The whole message is bold when there are no keywords.
      expect(within(alert).getByText(testConfig.messages.noOutput).tagName).toBe('SPAN');
    });

    it('shows a danger response at the error level', async () => {
      stubFetch(answer(response({ level: 'danger', output: 'Device unreachable.' })));
      renderResult();
      await settled();

      expect(screen.getByRole('alert', { hidden: true })).toHaveAttribute('data-status', 'error');
    });

    it.each([
      ['a timeout', new Error('Timeout exceeded'), testConfig.messages.requestTimeout],
      ['a failed request', new Error('network unreachable'), 'Network Unreachable'],
      ['a bad HTTP response', { statusText: 'service unavailable' }, 'Service Unavailable'],
      [
        'an error response',
        { level: 'warning', output: 'Rate limited.', keywords: [] },
        'Rate limited.',
      ],
      ['an unknown error', {}, testConfig.messages.general],
    ])('shows the message for %s', async (_, error, message) => {
      stubFetch(vi.fn(async () => Promise.reject(error)));
      renderResult();
      await settled();

      expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(message);
    });

    // A request that fails without an error body (#509). `useLGQuery` surfaces each of
    // these as an `error` with no `data`.
    it.each([
      [
        // `fetchWithTimeout` aborts the request once `requestTimeout` passes.
        'a timed out request',
        async () => Promise.reject(new DOMException('This operation was aborted', 'AbortError')),
        testConfig.messages.requestTimeout,
      ],
      [
        'a network error',
        async () => Promise.reject(new TypeError('Failed to fetch')),
        'Failed To Fetch',
      ],
      [
        'a response that is not JSON',
        async () =>
          ({
            json: async () => Promise.reject(new SyntaxError('Unexpected token <')),
            statusText: 'bad gateway',
          }) as unknown as Response,
        'Bad Gateway',
      ],
    ])('expands and flags %s as an error', async (_, impl, message) => {
      stubFetch(vi.fn(impl));
      renderResult();
      await settled();

      const alert = screen.getByRole('alert', { hidden: true });
      expect(alert).toHaveTextContent(message);
      expect(alert).toHaveAttribute('data-status', 'error');
      expect(screen.queryByText(testConfig.web.text.cachePrefix.trim())).not.toBeInTheDocument();
      expect(statusIconPath()).toBe(errorIconPath());
      await userEvent.hover(statusIcon() as Element);
      expect(
        await screen.findByRole('tooltip', { name: message }, IMPORT_WAIT),
      ).toBeInTheDocument();
    });

    it('shows the error when a requery fails', async () => {
      const fetch = stubFetch(
        vi
          .fn()
          .mockResolvedValueOnce({ json: async () => response({ output: 'first' }) })
          .mockRejectedValueOnce(new TypeError('Failed to fetch')),
      );
      const { container } = renderResult();
      await settled();
      const successIconPath = statusIconPath();

      await userEvent.click(actionButtons()[1]);

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('alert', { hidden: true })).toHaveTextContent(
        'Failed To Fetch',
      );
      expect(container.querySelector('pre')).not.toBeInTheDocument();
      expect(statusIconPath()).toBe(errorIconPath());
      expect(statusIconPath()).not.toBe(successIconPath);
    });

    it('shows a toast and nothing else for an unknown device', async () => {
      const fetch = stubFetch(answer(response()));
      const { container } = renderResult({ queryLocation: 'router_nowhere' });

      expect(await screen.findByText(testConfig.messages.general)).toBeInTheDocument();
      expect(
        screen.getByText("Configuration for device with ID 'router_nowhere' not found."),
      ).toBeInTheDocument();
      expect(container.querySelector('.chakra-accordion__item')).not.toBeInTheDocument();
      // The query still runs: hooks are called before the device check.
      await waitFor(() => expect(fetch).toHaveBeenCalled());
    });
  });

  describe('loading', () => {
    it('shows a spinner and disables the item until the query settles', async () => {
      let resolve: (value: Response) => void = () => undefined;
      stubFetch(
        vi.fn(
          () =>
            new Promise<Response>(r => {
              resolve = r;
            }),
        ),
      );
      renderResult();

      await waitFor(() => expect(header()).toBeDisabled());
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(header()).toHaveAttribute('aria-expanded', 'false');
      // Copy and requery; the AS path button only appears with structured output.
      expect(actionButtons()).toHaveLength(2);
      for (const button of actionButtons()) {
        expect(button).toHaveAttribute('disabled');
      }

      resolve({ json: async () => response(), statusText: 'OK' } as Response);
      await settled();

      expect(header()).toBeEnabled();
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });

  describe('requery', () => {
    it('runs the query again and shows the new output', async () => {
      const fetch = stubFetch(
        vi
          .fn()
          .mockResolvedValueOnce({ json: async () => response({ output: 'first' }) })
          .mockResolvedValueOnce({ json: async () => response({ output: 'second' }) }),
      );
      const { container } = renderResult();
      await settled();
      expect(container.querySelector('pre')).toHaveTextContent('first');

      const requery = actionButtons()[1];
      await userEvent.hover(requery);
      expect(
        await screen.findByRole('tooltip', { name: 'Reload Query' }, IMPORT_WAIT),
      ).toBeInTheDocument();
      await userEvent.click(requery);

      await waitFor(() => expect(container.querySelector('pre')).toHaveTextContent('second'));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(useFormState.getState().responses.router_one.output).toBe('second');
    });
  });

  describe('cache indicator', () => {
    it('shows the cache countdown for a cached response', async () => {
      stubFetch(answer(response({ cached: true })));
      renderResult();
      await settled();

      expect(screen.getByText(testConfig.web.text.cachePrefix.trim())).toBeInTheDocument();
    });

    it('shows the cache time in a tooltip on wide screens', async () => {
      // Match only the open-ended widest breakpoint query, so Chakra picks a desktop layout.
      vi.spyOn(window, 'matchMedia').mockImplementation(
        query =>
          ({
            matches: !query.includes('max-width'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
          }) as MediaQueryList,
      );
      stubFetch(answer(response({ cached: true, timestamp: '2026-11-20 08:00:00' })));
      const { container } = renderResult();
      await settled();

      // On wide screens the lightning icon comes before the countdown. Chakra reads the
      // breakpoint after the first render, so wait for the order to change.
      const stack = (): HTMLElement =>
        screen.getByText(testConfig.web.text.cachePrefix.trim()).parentElement as HTMLElement;
      await waitFor(
        () => expect(stack().firstElementChild?.querySelector('svg')).toBeTruthy(),
        IMPORT_WAIT,
      );
      const lightning = stack().firstElementChild as HTMLElement;

      await userEvent.hover(lightning);

      expect(
        await screen.findByRole(
          'tooltip',
          { name: 'Cached from 2026-11-20 08:00:00 UTC' },
          IMPORT_WAIT,
        ),
      ).toBeInTheDocument();
    });

    it('hides the cache countdown for a fresh response', async () => {
      stubFetch(answer(response({ cached: false })));
      renderResult();
      await settled();

      expect(screen.queryByText(testConfig.web.text.cachePrefix.trim())).not.toBeInTheDocument();
    });

    it('hides the cache countdown when the configuration turns it off', async () => {
      stubFetch(answer(response({ cached: true })));
      renderResult({ config: makeConfig({ cache: { showText: false } }) });
      await settled();

      expect(screen.queryByText(testConfig.web.text.cachePrefix.trim())).not.toBeInTheDocument();
    });
  });
});
