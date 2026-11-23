import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, renderWithProviders, testConfig } from '~/__tests__/render';
import { useFormState } from '~/hooks';
import { Results } from './group';

import type { Device } from '~/types';

// `Results` runs one query per location through `useLGQuery`, which POSTs to
// `/api/query` with `fetch`. The stub answers every request with a text response.

const initialFormState = useFormState.getState();

const devices = testConfig.devices.flatMap(group => group.locations);

function device(id: string): Device {
  const found = devices.find(d => d.id === id);
  if (found === undefined) {
    throw new Error(`No device '${id}' in the fixture`);
  }
  return found;
}

function response(): QueryResponse {
  return {
    id: 'c0ffee',
    random: 'r4nd0m',
    cached: false,
    runtime: 2,
    level: 'success',
    timestamp: '2026-11-20 08:00:00',
    keywords: [],
    output: 'output',
    format: 'text/plain',
    enrichment: 'complete',
  };
}

let fetch: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;
const address = `${window.location.pathname}${window.location.search}${window.location.hash}`;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  fetch = vi.fn(async () => ({ json: async () => response(), statusText: 'OK' }) as Response);
  vi.stubGlobal('fetch', fetch);
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useFormState.setState(initialFormState, true);
});

afterEach(() => {
  useFormState.setState(initialFormState, true);
  Reflect.deleteProperty(navigator, 'clipboard');
  window.history.replaceState(null, '', address);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The results of a submitted query, as the form leaves them in the store. */
function submit(form: {
  queryLocation: string[];
  queryType: string;
  queryTarget: string[];
  queryVariables?: Record<string, string>;
}): void {
  useFormState.setState({
    form: { queryVariables: {}, ...form },
    filtered: { types: device(form.queryLocation[0]).directives, groups: [] },
    status: 'results',
  });
}

async function copyLinkButton(): Promise<HTMLElement> {
  const [button] = await screen.findAllByRole('button', { name: 'Copy Link' });
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  return button;
}

describe('Results', () => {
  it('has one copy link button for all locations', async () => {
    submit({
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTarget: ['2001:db8::/32'],
    });
    renderWithProviders(<Results />);
    await copyLinkButton();

    expect(screen.getAllByRole('button', { name: 'Copy Link' })).toHaveLength(1);
  });

  it('copies a link to the submitted query on the page path, without running it', async () => {
    window.history.replaceState(null, '', '/tools/lg/?utm_source=mail#results');
    submit({
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTarget: ['2001:db8::/32'],
    });
    renderWithProviders(<Results />);
    const button = await copyLinkButton();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await userEvent.click(button);

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/tools/lg/?location=router_one&location=router_two&type=__hyperglass_juniper_bgp_route__&target=2001%3Adb8%3A%3A%2F32`,
    );
    // Copying runs nothing and leaves the query and the address as they were.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useFormState.getState().status).toBe('results');
    expect(window.location.search).toBe('?utm_source=mail');
  });

  it('links a select target', async () => {
    submit({
      queryLocation: ['router_three'],
      queryType: 'peer_communities',
      queryTarget: ['65000:2'],
    });
    renderWithProviders(<Results />);

    await userEvent.click(await copyLinkButton());

    const link = new URL(writeText.mock.calls[0][0] as string);
    expect(link.searchParams.getAll('location')).toEqual(['router_three']);
    expect(link.searchParams.get('type')).toBe('peer_communities');
    expect(link.searchParams.get('target')).toBe('65000:2');
  });

  it('links the variables the form submitted', async () => {
    submit({
      queryLocation: ['router_one'],
      queryType: '__hyperglass_juniper_ping__',
      queryTarget: ['192.0.2.1'],
      queryVariables: { vrf: 'customer' },
    });
    renderWithProviders(<Results />);

    await userEvent.click(await copyLinkButton());

    const link = new URL(writeText.mock.calls[0][0] as string);
    expect(Array.from(link.searchParams.keys())).toEqual(['location', 'type', 'target', 'var.vrf']);
    expect(link.searchParams.get('var.vrf')).toBe('customer');
  });
});
