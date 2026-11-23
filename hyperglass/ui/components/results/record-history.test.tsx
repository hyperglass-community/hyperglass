import { Accordion } from '@chakra-ui/react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { useFormState, useHistoryView, useQueryHistory } from '~/hooks';
import { Result } from './individual';

import type { Config, Directive } from '~/types';

// The live `Result` saves each successful response to the query history (#556).

const initialFormState = useFormState.getState();

const directive = testConfig.devices
  .flatMap(group => group.locations)
  .flatMap(device => device.directives)
  .find(d => d.id === '__hyperglass_juniper_bgp_route__') as Directive;

const form = {
  queryLocation: ['router_one'],
  queryTarget: ['2001:db8::/32'],
  queryType: directive.id,
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
    output: 'show route 2001:db8::/32\n2001:db8::/32 *[BGP/170] via 2001:db8:ffff::1',
    format: 'text/plain',
    enrichment: 'complete',
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body, statusText: 'OK' } as Response;
}

function stubFetch(impl: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
  vi.stubGlobal('fetch', impl);
  return impl;
}

function renderResults(locations: string[] = ['router_one'], config?: Config) {
  return renderWithProviders(
    <Accordion allowMultiple>
      {locations.map((location, index) => (
        <Result key={location} index={index} queryLocation={location} />
      ))}
    </Accordion>,
    { config },
  );
}

/** Wait until the result for `name` has settled, which expands it. */
async function settled(name = 'Router One'): Promise<void> {
  const header = screen.getByRole('button', { name: new RegExp(name) });
  await waitFor(() => expect(header).toHaveAttribute('aria-expanded', 'true'), IMPORT_WAIT);
}

/** Wait until the result for `name` has finished its request. */
async function finished(name = 'Router One'): Promise<void> {
  const header = screen.getByRole('button', { name: new RegExp(name) });
  await waitFor(() => expect(header).toBeEnabled(), IMPORT_WAIT);
}

function entries() {
  return useQueryHistory.getState().entries;
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  useFormState.setState(
    { ...initialFormState, form, filtered: { types: [directive], groups: [] } },
    true,
  );
  // As the form does on submit.
  useFormState.getState().setStatus('results');
  // `Result` logs every non-success response.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  // Unmount before resetting the stores, so a mounted `Result` doesn't query again.
  cleanup();
  useFormState.setState(initialFormState, true);
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null });
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Result query history', () => {
  it('saves a successful response, with the query and its labels', async () => {
    const data = response();
    stubFetch(vi.fn(async () => jsonResponse(data)));
    renderResults();
    await settled();

    expect(entries()).toEqual([
      {
        id: useFormState.getState().submissionId,
        savedAt: expect.any(Number),
        query: {
          queryLocation: ['router_one'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTypeName: 'BGP Route',
          queryTarget: ['2001:db8::/32'],
          queryVariables: {},
        },
        labels: {
          locations: ['Router One'],
          type: 'BGP Route',
          target: '2001:db8::/32',
          variables: [],
        },
        results: { router_one: { name: 'Router One', queryId: 'c0ffee', data } },
      },
    ]);
  });

  it('labels the variables with their names and option names', async () => {
    const withVariables: Directive = {
      ...directive,
      variables: [
        {
          id: 'vrf',
          name: 'VRF',
          required: false,
          options: [{ value: 'blue', name: 'Blue VRF', description: null }],
        },
        { id: 'unset', name: 'Unset', required: false, options: [] },
      ],
    };
    useFormState.setState({
      form: { ...form, queryVariables: { vrf: 'blue' } },
      filtered: { types: [withVariables], groups: [] },
    });
    stubFetch(vi.fn(async () => jsonResponse(response())));
    renderResults();
    await settled();

    expect(entries()[0].query.queryVariables).toEqual({ vrf: 'blue' });
    expect(entries()[0].labels.variables).toEqual(['VRF: Blue VRF']);
  });

  it('saves the locations of one query in one entry', async () => {
    useFormState.setState({ form: { ...form, queryLocation: ['router_one', 'router_two'] } });
    stubFetch(
      vi.fn(async (_url: string, init: RequestInit) => {
        const { queryLocation } = JSON.parse(init.body as string);
        return jsonResponse(response({ id: `id-${queryLocation}` }));
      }),
    );
    renderResults(['router_one', 'router_two']);
    // One of them expands, whichever settles first.
    await finished('Router One');
    await finished('Router Two');
    await waitFor(() => expect(Object.keys(entries()[0]?.results ?? {})).toHaveLength(2));

    expect(entries()).toHaveLength(1);
    expect(entries()[0].labels.locations).toEqual(['Router One', 'Router Two']);
    expect(entries()[0].results.router_two).toMatchObject({
      name: 'Router Two',
      queryId: 'id-router_two',
    });
  });

  it.each([
    ['an error response', () => jsonResponse(response({ level: 'error', output: 'denied' }))],
    ['a warning response', () => jsonResponse(response({ level: 'warning', output: 'no route' }))],
    [
      'a timed out request',
      () => Promise.reject(new DOMException('This operation was aborted', 'AbortError')),
    ],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    [
      'a response that is not JSON',
      () =>
        ({
          json: async () => Promise.reject(new SyntaxError('Unexpected token <')),
          statusText: 'bad gateway',
        }) as unknown as Response,
    ],
  ])('does not save %s', async (_, impl) => {
    stubFetch(vi.fn(async () => impl()));
    renderResults();
    await finished();
    await settled();

    expect(entries()).toEqual([]);
  });

  it('does not save a response the history could not show', async () => {
    // A success whose structured output has no routes or hops.
    stubFetch(
      vi.fn(async () => jsonResponse(response({ format: 'application/json', output: 'x' }))),
    );
    renderResults();
    await finished();

    expect(entries()).toEqual([]);
  });

  it('saves nothing when history is disabled', async () => {
    stubFetch(vi.fn(async () => jsonResponse(response())));
    renderResults(['router_one'], makeConfig({ web: { history: { enable: false } } }));
    await settled();

    expect(entries()).toEqual([]);
    expect(localStorage.getItem('hyperglass.history')).toBeNull();
  });

  it('keeps the configured number of entries', async () => {
    useQueryHistory.getState().record(
      {
        submissionId: 'older',
        query: { ...form, queryTypeName: 'BGP Route' },
        labels: {
          locations: ['Router One'],
          type: 'BGP Route',
          target: '192.0.2.0/24',
          variables: [],
        },
        deviceId: 'router_one',
        result: { name: 'Router One', queryId: 'old', data: response({ id: 'old' }) },
        retain: true,
      },
      10,
    );
    stubFetch(vi.fn(async () => jsonResponse(response())));
    renderResults(['router_one'], makeConfig({ web: { history: { limit: 1 } } }));
    await settled();

    expect(entries().map(e => e.id)).toEqual([useFormState.getState().submissionId]);
  });

  it('updates the entry when the enrichment completes', async () => {
    const pending = response({ enrichment: 'pending', output: 'plain output' });
    stubFetch(
      vi.fn(async (url: string) =>
        url === `/api/query/${pending.id}/enrichment`
          ? jsonResponse({ status: 'complete', output: 'enriched output' })
          : jsonResponse(pending),
      ),
    );
    renderResults();
    await settled();

    await waitFor(() =>
      expect(entries()[0]?.results.router_one.data).toMatchObject({
        enrichment: 'complete',
        output: 'enriched output',
      }),
    );
    expect(entries()).toHaveLength(1);
  });

  it('keeps the saved response when running the query again fails', async () => {
    const data = response();
    const fetch = stubFetch(
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(data))
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    );
    renderResults();
    await settled();
    expect(entries()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: testConfig.web.text.reloadQuery }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await screen.findByRole('alert', { hidden: true });

    expect(entries()).toHaveLength(1);
    expect(entries()[0].results.router_one.data).toEqual(data);
  });

  it('saves the new response when the query runs again', async () => {
    stubFetch(
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(response({ output: 'first' })))
        .mockResolvedValueOnce(jsonResponse(response({ id: 'second', output: 'second' }))),
    );
    renderResults();
    await settled();

    await userEvent.click(screen.getByRole('button', { name: testConfig.web.text.reloadQuery }));

    await waitFor(() => expect(entries()[0].results.router_one.queryId).toBe('second'));
    expect(entries()).toHaveLength(1);
    expect(entries()[0].results.router_one.data.output).toBe('second');
  });
});

// A directive with `retain: false` keeps its results out of the history (#558).
describe('Result query history with retain: false', () => {
  const juniperRoute = '__hyperglass_juniper_bgp_route__';
  const aristaRoute = '__hyperglass_arista_eos_bgp_route__';

  /** The test configuration, with `retain: false` on the directives with these IDs. */
  function unretained(...ids: string[]): Config {
    const config = makeConfig();
    config.devices = config.devices.map(group => ({
      ...group,
      locations: group.locations.map(location => ({
        ...location,
        directives: location.directives.map(d =>
          ids.includes(d.id) ? { ...d, retain: false } : d,
        ),
      })),
    }));
    return config;
  }

  function stubByLocation(): void {
    stubFetch(
      vi.fn(async (_url: string, init: RequestInit) => {
        const { queryLocation } = JSON.parse(init.body as string);
        return jsonResponse(response({ id: `id-${queryLocation}` }));
      }),
    );
  }

  it('saves nothing for a directive that does not retain its results', async () => {
    stubFetch(vi.fn(async () => jsonResponse(response())));
    renderResults(['router_one'], unretained(juniperRoute));
    await settled();

    expect(entries()).toEqual([]);
    expect(localStorage.getItem('hyperglass.history')).toBeNull();
  });

  it.each([
    ["another location's directive does not", aristaRoute, 'router_one'],
    ["the query type's own directive does not", juniperRoute, 'router_two'],
  ])(
    'saves only the locations whose directive retains its results, when %s',
    async (_, off, kept) => {
      // Both locations run "BGP Route": Juniper's by its ID, Arista's by its name.
      useFormState.setState({ form: { ...form, queryLocation: ['router_one', 'router_two'] } });
      stubByLocation();
      renderResults(['router_one', 'router_two'], unretained(off));
      await finished('Router One');
      await finished('Router Two');
      await waitFor(() => expect(entries()).toHaveLength(1));

      expect(Object.keys(entries()[0].results)).toEqual([kept]);
      expect(entries()[0].labels.locations).toEqual(['Router One', 'Router Two']);
    },
  );

  it("saves nothing for a query type the location doesn't list", async () => {
    // Neither the ID nor the name is one of Router One's directives.
    const unknown: Directive = { ...directive, id: 'unlisted', name: 'Unlisted' };
    useFormState.setState({
      form: { ...form, queryType: unknown.id },
      filtered: { types: [unknown], groups: [] },
    });
    stubFetch(vi.fn(async () => jsonResponse(response())));
    renderResults();
    await settled();

    expect(entries()).toEqual([]);
  });

  it('shows nothing about history or sharing for such a directive', async () => {
    stubFetch(vi.fn(async () => jsonResponse(response())));

    /** The result's buttons and text, once settled. */
    async function rendered(config: Config): Promise<[string[], string]> {
      const { container } = renderResults(['router_one'], config);
      await settled();
      await waitFor(
        () => expect(container.querySelectorAll('button svg').length).toBeGreaterThan(0),
        IMPORT_WAIT,
      );
      const names = screen
        .getAllByRole('button')
        .map(b => b.getAttribute('aria-label') ?? b.textContent ?? '');
      const text = container.textContent ?? '';
      cleanup();
      return [names, text];
    }

    const retained = await rendered(makeConfig());
    useFormState.setState({ submissionId: 'another' });
    const notRetained = await rendered(unretained(juniperRoute));

    // The same result as for a directive that retains it: no hint, icon or control.
    expect(notRetained).toEqual(retained);
    expect(notRetained[1]).not.toMatch(/history|share|recent|saved/i);
  });
});
