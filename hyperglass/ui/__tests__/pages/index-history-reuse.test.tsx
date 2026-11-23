import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { Layout } from '~/components/layout';
import { useFormState, useGreeting, useHistoryView, useQueryHistory } from '~/hooks';
import Index from '../../pages/index';

import type { HistoryEntry, HistoryQuery } from '~/hooks';
import type { Config, Device, Directive } from '~/types';

// Run again and New target (#557): a saved query fills the real form, which submits it
// (Run again) through its own submit path, or waits for a new target. The page chrome is
// stubbed as in the history tests, so `Layout` keeps browser history in step with the view.
vi.mock('~/components', async importOriginal => ({
  ...(await importOriginal<typeof import('~/components')>()),
  Debugger: () => null,
  Footer: () => null,
  Greeting: () => null,
  Header: () => null,
}));
// The chart needs a layout engine that jsdom lacks.
vi.mock('~/components/path/chart', () => ({ Chart: () => null }));

const router = vi.hoisted(() => ({
  isReady: true,
  pathname: '/',
  replace: vi.fn(async () => true),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));

const { text } = testConfig.web;

/** `messages.noInput` for a field label, as the form formats it. */
const noInput = (field: string): string => testConfig.messages.noInput.replace('{field}', field);
const initialFormState = useFormState.getState();

function response(id: string): QueryResponse {
  return {
    id,
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-21 10:00:00',
    keywords: [],
    output: `output of ${id}`,
    format: 'text/plain',
    enrichment: 'complete',
  };
}

/** A saved query for these locations (with these names), as `useRecordHistory` saves it. */
function entry(
  id: string,
  query: Partial<HistoryQuery> & { queryTarget: string[] },
  names: string[] = ['Router One'],
): HistoryEntry {
  const full: HistoryQuery = {
    queryLocation: ['router_one'],
    queryType: '__hyperglass_juniper_bgp_route__',
    queryTypeName: 'BGP Route',
    queryVariables: {},
    ...query,
  };
  return {
    id,
    savedAt: Date.parse('2026-11-21T10:00:00Z'),
    query: full,
    labels: {
      locations: names,
      type: full.queryTypeName,
      target: full.queryTarget.join(', '),
      variables: [],
    },
    results: {
      [full.queryLocation[0]]: { name: names[0], queryId: id, data: response(id) },
    },
  };
}

/** The fixture device with this ID. */
function device(id: string): Device {
  const found = testConfig.devices.flatMap(g => g.locations).find(d => d.id === id);
  if (found === undefined) {
    throw new Error(`No device '${id}' in the fixture`);
  }
  return found;
}

/** Router One only, with a VRF variable on its BGP Route. */
function vrfConfig(): Config {
  const dev = structuredClone(device('router_one'));
  dev.directives = dev.directives.map(d =>
    d.name === 'BGP Route'
      ? ({
          ...d,
          variables: [
            {
              id: 'vrf',
              name: 'VRF',
              required: false,
              options: [
                { name: 'Default', value: 'default', description: null },
                { name: 'Customer', value: 'customer', description: null },
              ],
            },
          ],
        } as unknown as Directive)
      : d,
  );
  return makeConfig({ devices: [{ group: 'North America', locations: [dev] }] } as never);
}

/** The configuration without Router One: a location removed since a query was saved. */
function withoutRouterOne(): Config {
  return makeConfig({
    devices: testConfig.devices
      .map(g => ({ ...g, locations: g.locations.filter(l => l.id !== 'router_one') }))
      .filter(g => g.locations.length > 0),
  } as never);
}

let fetch: ReturnType<typeof vi.fn>;

/** The bodies of the queries sent to `/api/query`. */
function queries(): Record<string, unknown>[] {
  return fetch.mock.calls
    .filter(([url]) => String(url).includes('/api/query'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function renderPage(config?: Config) {
  return renderWithProviders(
    <Layout>
      <Index />
    </Layout>,
    { config },
  );
}

async function recentQueries(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: text.historyTitle }, IMPORT_WAIT);
}

/** A button of the saved query at `index`, once its icon has loaded. */
async function rowButton(index: number, name: string): Promise<HTMLElement> {
  const row = within(await recentQueries()).getAllByRole('listitem')[index];
  const button = within(row).getByRole('button', { name });
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  return button;
}

function seed(...entries: HistoryEntry[]): void {
  useQueryHistory.setState({ entries });
}

async function targetInput(): Promise<HTMLElement> {
  return screen.findByPlaceholderText('IP Address, Prefix, or Hostname', undefined, IMPORT_WAIT);
}

async function submitButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: 'Submit Query' }, IMPORT_WAIT);
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
  fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes('/api/query')) {
      const body = JSON.parse(init.body as string);
      return { ok: true, statusText: 'OK', json: async () => response(body.queryLocation) };
    }
    // DNS queries of the hostname resolver: leave them pending.
    return new Promise(() => undefined);
  });
  vi.stubGlobal('fetch', fetch);
  window.history.replaceState(null, '');
  act(() => {
    useGreeting.setState({ isAck: true, isOpen: false, greetingReady: true });
  });
});

afterEach(() => {
  act(() => {
    useFormState.setState(initialFormState, true);
    useQueryHistory.setState({ entries: [] });
    useHistoryView.setState({ openId: null, returnFocusId: null, pending: null });
  });
  localStorage.clear();
  window.history.replaceState(null, '');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Run again', () => {
  it.each([
    ['an IPv4 prefix', '192.0.2.0/24'],
    ['an IPv6 prefix', '2001:db8::/32'],
    ['an IPv6 address', '2001:db8::1'],
  ])('runs a saved query for %s with its stored values', async (_, target) => {
    seed(
      entry('saved', {
        queryLocation: ['router_one', 'router_two'],
        queryTarget: [target],
      }),
    );
    renderPage();
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(queries()).toHaveLength(2));
    expect(queries()).toEqual([
      {
        queryLocation: 'router_one',
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTarget: [target],
        queryVariables: {},
      },
      {
        queryLocation: 'router_two',
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTarget: [target],
        queryVariables: {},
      },
    ]);
    expect(useFormState.getState().status).toBe('results');
    expect(screen.queryByRole('region', { name: text.historyTitle })).not.toBeInTheDocument();
    // The results have their own browser history entry, as a submitted query's do.
    expect(window.history.state).toEqual({ ultraglass: 'results' });
  });

  it('runs once the greeting is acknowledged, with the stored values', async () => {
    act(() => {
      useGreeting.setState({ isAck: true, greetingReady: true });
    });
    seed(entry('saved', { queryTarget: ['198.51.100.0/24'] }));
    const config = makeConfig({ web: { greeting: { enable: true, required: true } } });
    renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() =>
      expect(queries()).toEqual([
        {
          queryLocation: 'router_one',
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['198.51.100.0/24'],
          queryVariables: {},
        },
      ]),
    );
    expect(
      await screen.findByText('output of router_one', undefined, IMPORT_WAIT),
    ).toBeInTheDocument();
  });

  it('does not run while a required greeting is not acknowledged', async () => {
    act(() => {
      useGreeting.setState({ isAck: false, greetingReady: false });
    });
    seed(entry('saved', { queryTarget: ['198.51.100.0/24'] }));
    const config = makeConfig({ web: { greeting: { enable: true, required: true } } });
    renderPage(config);
    const button = await rowButton(0, text.historyRerun);
    // The form's submit path reloads the page, which shows the greeting again.
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as Location);

    await userEvent.click(button);

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
    expect(screen.getByRole('region', { name: text.historyTitle })).toBeInTheDocument();
  });

  it('resolves a hostname target before running', async () => {
    seed(
      entry('saved', {
        queryType: '__hyperglass_juniper_ping__',
        queryTypeName: 'Ping',
        queryTarget: ['example.com'],
      }),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(useFormState.getState().resolvedIsOpen).toBe(true));
    expect(useFormState.getState().loading).toBe(true);
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('runs a mixed-vendor query under the first location', async () => {
    seed(
      entry(
        'saved',
        {
          queryLocation: ['router_three', 'router_one'],
          queryType: '__hyperglass_frr_bgp_route__',
          queryTarget: ['2001:db8::/48'],
        },
        ['Router Three', 'Router One'],
      ),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(queries()).toHaveLength(2));
    expect(queries().map(q => [q.queryLocation, q.queryType])).toEqual([
      ['router_three', '__hyperglass_frr_bgp_route__'],
      ['router_one', '__hyperglass_frr_bgp_route__'],
    ]);
  });

  it('finds the query type by name when its ID changed', async () => {
    seed(
      entry('saved', {
        queryType: 'renamed_bgp_route',
        queryTypeName: 'BGP Route',
        queryTarget: ['192.0.2.0/24'],
      }),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(queries()).toHaveLength(1));
    expect(queries()[0].queryType).toBe('__hyperglass_juniper_bgp_route__');
  });

  it('runs a select target', async () => {
    seed(
      entry(
        'saved',
        {
          queryLocation: ['router_three'],
          queryType: 'peer_communities',
          queryTypeName: 'Peer Communities',
          queryTarget: ['65000:2'],
        },
        ['Router Three'],
      ),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() =>
      expect(queries()).toEqual([
        {
          queryLocation: 'router_three',
          queryType: 'peer_communities',
          queryTarget: ['65000:2'],
          queryVariables: {},
        },
      ]),
    );
  });

  it('does not run a select target the configuration no longer offers', async () => {
    seed(
      entry(
        'saved',
        {
          queryLocation: ['router_three'],
          queryType: 'peer_communities',
          queryTypeName: 'Peer Communities',
          queryTarget: ['65000:9'],
        },
        ['Router Three'],
      ),
    );
    const { container } = renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    // The form is filled without the target, which the form reports and focuses.
    expect(await screen.findByText(noInput(text.queryTarget))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        container.querySelector('[data-query-field="queryTarget"] input[role="combobox"]'),
      ).toHaveFocus(),
    );
    expect(useFormState.getState().form.queryType).toBe('peer_communities');
    expect(useFormState.getState().form.queryTarget).toEqual([]);
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('reports and focuses the query type when the saved one is gone', async () => {
    const dev = structuredClone(device('router_one'));
    dev.directives = dev.directives.filter(d => d.name !== 'BGP Route');
    const config = makeConfig({
      devices: [{ group: 'North America', locations: [dev] }],
    } as never);
    seed(entry('saved', { queryTarget: ['2001:db8::/32'] }));
    const { container } = renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await screen.findByText(noInput(text.queryType))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        container.querySelector('[data-query-field="queryType"] input[role="combobox"]'),
      ).toHaveFocus(),
    );
    expect(useFormState.getState().form.queryType).toBe('');
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('reports and focuses the target of a query saved with several targets', async () => {
    seed(entry('saved', { queryTarget: ['192.0.2.1', '2001:db8::1'] }));
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await screen.findByText(noInput(text.queryTarget))).toBeInTheDocument();
    const input = await targetInput();
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue('');
    expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_bgp_route__');
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('does not run another query type the form chose on its own', async () => {
    // BGP Route is gone; the location's only query type, without a target field, is
    // chosen by the form and gets its placeholder target.
    const dev = structuredClone(device('router_one'));
    dev.directives = [
      { ...dev.directives[0], id: 'summary', name: 'BGP Summary', fieldType: null },
    ] as unknown as Directive[];
    const config = makeConfig({
      devices: [{ group: 'North America', locations: [dev] }],
    } as never);
    seed(entry('saved', { queryTarget: ['2001:db8::/32'] }));
    const { container } = renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() =>
      expect(
        container.querySelector('[data-query-field="queryType"] input[role="combobox"]'),
      ).toHaveFocus(),
    );
    expect(useFormState.getState().form.queryType).toBe('summary');
    expect(useFormState.getState().status).toBe('form');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(queries()).toEqual([]);
  });

  it('does not run another query type without a target field in place of one', async () => {
    // The saved query type had no target field either, so the targets match.
    const dev = structuredClone(device('router_one'));
    dev.directives = [
      { ...dev.directives[0], id: 'neighbors', name: 'BGP Neighbors', fieldType: null },
    ] as unknown as Directive[];
    const config = makeConfig({
      devices: [{ group: 'North America', locations: [dev] }],
    } as never);
    seed(
      entry('saved', { queryType: 'summary', queryTypeName: 'BGP Summary', queryTarget: ['null'] }),
    );
    renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(useFormState.getState().form.queryType).toBe('neighbors'));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('does not run a query type that no longer takes the saved target', async () => {
    const dev = structuredClone(device('router_one'));
    dev.directives = dev.directives.map(d =>
      d.name === 'BGP Route' ? ({ ...d, fieldType: null } as unknown as Directive) : d,
    );
    const config = makeConfig({
      devices: [{ group: 'North America', locations: [dev] }],
    } as never);
    seed(entry('saved', { queryTarget: ['2001:db8::/32'] }));
    renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit Query' })).toHaveFocus());
    expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_bgp_route__');
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('runs a query type without a target field', async () => {
    const dev = structuredClone(device('router_one'));
    dev.directives = dev.directives.map(d =>
      d.name === 'BGP Route' ? ({ ...d, fieldType: null } as unknown as Directive) : d,
    );
    const config = makeConfig({
      devices: [{ group: 'North America', locations: [dev] }],
    } as never);
    seed(entry('saved', { queryTarget: ['null'] }));
    renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() =>
      expect(queries()).toEqual([
        {
          queryLocation: 'router_one',
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['null'],
          queryVariables: {},
        },
      ]),
    );
  });

  it('runs with the stored variables', async () => {
    seed(
      entry('saved', {
        queryTarget: ['2001:db8::/32'],
        queryVariables: { vrf: 'customer' },
      }),
    );
    renderPage(vrfConfig());

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() =>
      expect(queries()).toEqual([
        {
          queryLocation: 'router_one',
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['2001:db8::/32'],
          queryVariables: { vrf: 'customer' },
        },
      ]),
    );
  });

  it('only fills the form when a variable value is no longer offered', async () => {
    seed(
      entry('saved', {
        queryTarget: ['2001:db8::/32'],
        queryVariables: { vrf: 'removed' },
      }),
    );
    const { container } = renderPage(vrfConfig());

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await targetInput()).toHaveValue('2001:db8::/32');
    // Named on the variable's field, which gets focus.
    expect(await screen.findByText('No longer available: removed')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        container.querySelector('[data-query-field="var.vrf"] input[role="combobox"]'),
      ).toHaveFocus(),
    );
    expect(useFormState.getState().form.queryVariables).toEqual({});
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);
  });

  it('uses the configured message for a variable value that no longer exists', async () => {
    seed(
      entry('saved', {
        queryTarget: ['2001:db8::/32'],
        queryVariables: { vrf: 'removed' },
      }),
    );
    const config = vrfConfig();
    config.web.text.historyVariableUnavailable = 'Gone: {value}.';
    renderPage(config);

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await screen.findByText('Gone: removed.')).toBeInTheDocument();
  });

  it('names the locations that no longer exist, and only fills the form', async () => {
    seed(
      entry(
        'saved',
        {
          queryLocation: ['router_gone', 'router_two', 'router_lost'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['192.0.2.1'],
        },
        ['Router Gone', 'Router Two', 'Router Lost'],
      ),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(
      await screen.findByText('No longer available: Router Gone, Router Lost'),
    ).toBeInTheDocument();
    expect(await targetInput()).toHaveValue('192.0.2.1');
    // The remaining location's query type, found by name.
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_two'],
      queryType: '__hyperglass_arista_eos_bgp_route__',
      queryTarget: ['192.0.2.1'],
      queryVariables: {},
    });
    expect(useFormState.getState().status).toBe('form');
    expect(queries()).toEqual([]);

    // The visitor decides: Submit runs what is left.
    await userEvent.click(await submitButton());
    await waitFor(() => expect(queries()).toHaveLength(1));
    expect(queries()[0].queryLocation).toBe('router_two');
  });

  it('finds the query type by name when the first location was removed', async () => {
    seed(
      entry(
        'saved',
        {
          queryLocation: ['router_one', 'router_three'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['192.0.2.0/24'],
        },
        ['Router One', 'Router Three'],
      ),
    );
    renderPage(withoutRouterOne());

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await screen.findByText('No longer available: Router One')).toBeInTheDocument();
    expect(useFormState.getState().form.queryType).toBe('__hyperglass_frr_bgp_route__');
    expect(queries()).toEqual([]);
  });

  it('names every location when none is left, and keeps the form as it was', async () => {
    seed(
      entry('saved', { queryLocation: ['router_gone'], queryTarget: ['192.0.2.1'] }, [
        'Router Gone',
      ]),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await screen.findByText('No longer available: Router Gone')).toBeInTheDocument();
    expect(useFormState.getState().form.queryLocation).toEqual([]);
    expect(queries()).toEqual([]);
  });

  it('uses the configured message for the locations that no longer exist', async () => {
    seed(
      entry('saved', { queryLocation: ['router_gone'], queryTarget: ['192.0.2.1'] }, [
        'Router Gone',
      ]),
    );
    renderPage(makeConfig({ web: { text: { historyLocationUnavailable: 'Gone: {locations}.' } } }));

    await userEvent.click(await rowButton(0, text.historyRerun));

    expect(await screen.findByText('Gone: Router Gone.')).toBeInTheDocument();
  });

  it('replaces a query already in the form', async () => {
    seed(entry('saved', { queryTarget: ['192.0.2.0/24'] }));
    renderPage();
    await userEvent.click(await screen.findByText('Router Three', undefined, IMPORT_WAIT));

    await userEvent.click(await rowButton(0, text.historyRerun));

    await waitFor(() => expect(queries()).toHaveLength(1));
    expect(queries()[0]).toMatchObject({
      queryLocation: 'router_one',
      queryTarget: ['192.0.2.0/24'],
    });
  });

  it('works from the keyboard', async () => {
    seed(entry('saved', { queryTarget: ['192.0.2.0/24'] }));
    renderPage();
    (await rowButton(0, text.historyRerun)).focus();

    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(queries()).toHaveLength(1));
  });

  it('runs from an opened query, leaving its browser history entry', async () => {
    seed(entry('saved', { queryTarget: ['2001:db8::/32'] }));
    renderPage();
    await userEvent.click(await rowButton(0, text.historyOpen));
    expect(window.history.state).toEqual({ ultraglass: 'history' });

    await userEvent.click(
      await screen.findByRole('button', { name: text.historyRerun }, IMPORT_WAIT),
    );

    await waitFor(() => expect(queries()).toHaveLength(1));
    expect(queries()[0]).toMatchObject({ queryTarget: ['2001:db8::/32'] });
    expect(useHistoryView.getState().openId).toBeNull();
    expect(useFormState.getState().status).toBe('results');
    // The opened query's entry was left, then the results added their own.
    await waitFor(() => expect(window.history.state).toEqual({ ultraglass: 'results' }));

    // Back from the results returns to the form with the query, not to the opened entry.
    act(() => {
      window.history.back();
    });
    expect(await recentQueries()).toBeInTheDocument();
    expect(useHistoryView.getState().openId).toBeNull();
    expect(await targetInput()).toHaveValue('2001:db8::/32');
    // The saved query was taken once: the form's return doesn't run it again.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(queries()).toHaveLength(1);
  });
});

describe('New target', () => {
  it('fills everything but the target and focuses the target field', async () => {
    seed(
      entry('saved', {
        queryLocation: ['router_one', 'router_two'],
        queryTarget: ['2001:db8::/32'],
      }),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyNewTarget));

    const input = await targetInput();
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue('');
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTarget: [],
      queryVariables: {},
    });
    expect(useFormState.getState().status).toBe('form');
    expect(fetch).not.toHaveBeenCalled();

    // No request until the visitor submits.
    await userEvent.type(input, '2001:db8:1::/48');
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(await submitButton());
    await waitFor(() => expect(queries()).toHaveLength(2));
    expect(queries()[0]).toMatchObject({
      queryLocation: 'router_one',
      queryTarget: ['2001:db8:1::/48'],
    });
  });

  it('keeps the stored variables', async () => {
    seed(
      entry('saved', {
        queryTarget: ['2001:db8::/32'],
        queryVariables: { vrf: 'customer' },
      }),
    );
    renderPage(vrfConfig());

    await userEvent.click(await rowButton(0, text.historyNewTarget));

    await waitFor(async () => expect(await targetInput()).toHaveFocus());
    expect(useFormState.getState().form.queryVariables).toEqual({ vrf: 'customer' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('focuses a select target', async () => {
    seed(
      entry(
        'saved',
        {
          queryLocation: ['router_three'],
          queryType: 'peer_communities',
          queryTypeName: 'Peer Communities',
          queryTarget: ['65000:2'],
        },
        ['Router Three'],
      ),
    );
    const { container } = renderPage();

    await userEvent.click(await rowButton(0, text.historyNewTarget));

    await waitFor(() =>
      expect(
        container.querySelector('[data-query-field="queryTarget"] input[role="combobox"]'),
      ).toHaveFocus(),
    );
    expect(useFormState.getState().form.queryTarget).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names the locations that no longer exist', async () => {
    seed(
      entry('saved', { queryLocation: ['router_one', 'router_gone'], queryTarget: ['192.0.2.1'] }, [
        'Router One',
        'Router Gone',
      ]),
    );
    renderPage();

    await userEvent.click(await rowButton(0, text.historyNewTarget));

    expect(await screen.findByText('No longer available: Router Gone')).toBeInTheDocument();
    await waitFor(async () => expect(await targetInput()).toHaveFocus());
    expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
  });

  it('works from an opened query, and focus stays on the target field', async () => {
    seed(entry('saved', { queryTarget: ['2001:db8::/32'] }));
    renderPage();
    await userEvent.click(await rowButton(0, text.historyOpen));

    await userEvent.click(
      await screen.findByRole('button', { name: text.historyNewTarget }, IMPORT_WAIT),
    );

    const input = await targetInput();
    await waitFor(() => expect(input).toHaveFocus());
    expect(await recentQueries()).toBeInTheDocument();
    expect(useHistoryView.getState().openId).toBeNull();
    // The Open button of the closed query doesn't take focus back.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(input).toHaveFocus();
    expect(window.history.state).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
