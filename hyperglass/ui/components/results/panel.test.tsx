import { Accordion } from '@chakra-ui/react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { Path } from '~/components/path/path';
import { useFormState } from '~/hooks';
import { CopyButton } from './copy-button';
import { ResultsView } from './group';
import { Result, ResultPanel } from './individual';
import { Tags } from './tags';

import type { ResultButtonsState, ResultQueryState } from './individual';

// The chart needs a layout engine that jsdom lacks; the modal around it is what matters here.
vi.mock('~/components/path/chart', () => ({ Chart: () => null }));

const initialFormState = useFormState.getState();

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

/** BGP output without ASN organizations, which the live AS path looks up when opened. */
function bgpOutput(): StructuredResponse {
  return {
    vrf: 'default',
    count: 1,
    routes: [
      {
        prefix: '2001:db8::/32',
        active: true,
        age: 3600,
        weight: 170,
        med: 0,
        local_preference: 100,
        as_path: [65001, 64496],
        communities: ['65001:100'],
        next_hop: '2001:db8:ffff::1',
        source_as: 64496,
        source_rid: '198.51.100.1',
        peer_rid: '198.51.100.1',
        rpki_state: 1,
        filtered: false,
      },
    ],
    winning_weight: 'low',
    asn_organizations: {},
  } as StructuredResponse;
}

// Enrichment is on, so the live AS path would look up ASN organizations.
const config = makeConfig({ web: { aspathEnrichment: true } });

function stored(data: QueryResponse): ResultQueryState {
  return { data, error: null, isLoading: false, isFetching: false, isFetchedAfterMount: true };
}

/** The buttons a view of a stored result would pass: copy, and an AS path with no lookup. */
function storedButtons(displayTarget: string) {
  return ({ data, copyValue, isQuerying, showPath }: ResultButtonsState) => (
    <>
      {showPath && <Path response={data ?? null} displayTarget={displayTarget} />}
      <CopyButton copyValue={copyValue} isDisabled={isQuerying} />
    </>
  );
}

function renderStored(data: QueryResponse, displayTarget = '2001:db8::/32') {
  return renderWithProviders(
    <Accordion allowMultiple>
      <ResultPanel
        index={0}
        queryLocation="router_one"
        queryTarget={[displayTarget]}
        query={stored(data)}
        errorLevel={data.level === 'warning' ? 'warning' : 'error'}
        buttons={storedButtons(displayTarget)}
      />
    </Accordion>,
    { config },
  );
}

function header(): HTMLElement {
  return screen.getByRole('button', { name: /Router One/ });
}

/** Wait until the result has expanded and its status icon has loaded. */
async function settled(): Promise<void> {
  await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'true'), IMPORT_WAIT);
  await waitFor(
    () => expect(header().querySelector('svg:not(.chakra-accordion__icon)')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
}

/** The buttons next to the accordion header. */
function actionButtons(): HTMLElement[] {
  const row = header().parentElement as HTMLElement;
  return Array.from(row.querySelectorAll<HTMLElement>('.chakra-button'));
}

/** Open the AS path modal from the first header button. */
async function openPath(): Promise<HTMLElement> {
  const [path] = actionButtons();
  await waitFor(() => expect(path.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  await userEvent.click(path);
  return screen.findByRole('dialog');
}

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Any request fails the test: the assertions below check `fetch` was never called.
  fetch = vi.fn(async () => Promise.reject(new Error('no request expected')));
  vi.stubGlobal('fetch', fetch);
  // No form state: a stored result does not come from the form.
  useFormState.setState(initialFormState, true);
});

afterEach(() => {
  useFormState.setState(initialFormState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ResultPanel', () => {
  it('renders a stored text response with no form state and no request', async () => {
    const { container } = renderStored(response());
    await settled();

    expect(header()).toHaveTextContent('Router One');
    expect(container.querySelector('pre')).toHaveTextContent(
      '192.0.2.0/24 *[BGP/170] via 198.51.100.1',
    );
    // Only the buttons it was given: copy.
    expect(actionButtons()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(useFormState.getState().responses).toEqual({});
  });

  it('shows a stored error response at the given level', async () => {
    const output = '2001:db8::/32 is not allowed.';
    renderStored(response({ level: 'warning', output, keywords: ['2001:db8::/32'] }));
    await settled();

    const alert = screen.getByRole('alert', { hidden: true });
    expect(alert).toHaveTextContent(output);
    expect(alert).toHaveAttribute('data-status', 'warning');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not poll for enrichment of a response stored while it was pending', async () => {
    renderStored(response({ enrichment: 'pending' }));
    await settled();

    // The live result polls every second while enrichment is pending.
    await new Promise(resolve => setTimeout(resolve, 1500));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders a stored BGP table and opens its AS path with no request', async () => {
    renderStored(response({ format: 'application/json', output: bgpOutput() }));
    await settled();

    const table = await screen.findByRole('table', { hidden: true });
    expect(within(table).getByText('2001:db8::/32')).toBeInTheDocument();
    // AS path and copy.
    expect(actionButtons()).toHaveLength(2);

    expect(await openPath()).toHaveAccessibleName('Path to 2001:db8::/32');
    expect(fetch).not.toHaveBeenCalled();
    expect(useFormState.getState().responses).toEqual({});
  });
});

describe('ResultsView', () => {
  it('renders the tags and results it is given', () => {
    renderWithProviders(
      <ResultsView
        tags={
          <Tags
            queryLocation={['router_one']}
            queryType="BGP Route"
            queryTarget={['2001:db8::/32']}
          />
        }
      >
        <div key="router_one">result for router_one</div>
      </ResultsView>,
    );

    expect(screen.getByText('BGP Route')).toBeInTheDocument();
    expect(screen.getByText('2001:db8::/32')).toBeInTheDocument();
    expect(screen.getByText('result for router_one')).toBeInTheDocument();
  });
});

describe('Result', () => {
  it('looks up ASN organizations for the live AS path and stores the enriched response', async () => {
    const organizations = { '65001': { name: 'Example Org', country: 'CA' } };
    fetch.mockImplementation(async (url: string) => ({
      ok: true,
      statusText: 'OK',
      json: async () =>
        url === '/api/aspath/enrich'
          ? { success: true, asn_organizations: organizations }
          : response({ format: 'application/json', output: bgpOutput() }),
    }));
    useFormState.setState({
      form: {
        queryLocation: ['router_one'],
        queryTarget: ['2001:db8::/32'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryVariables: {},
      },
      target: { display: '2001:db8::/32' },
    });
    renderWithProviders(
      <Accordion allowMultiple>
        <Result index={0} queryLocation="router_one" />
      </Accordion>,
      { config },
    );
    await settled();

    // AS path, copy and requery.
    expect(actionButtons()).toHaveLength(3);
    expect(await openPath()).toHaveAccessibleName('Path to 2001:db8::/32');

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/aspath/enrich', expect.anything()),
    );
    await waitFor(() =>
      expect(
        (useFormState.getState().response('router_one')?.output as StructuredResponse)
          .asn_organizations,
      ).toEqual(organizations),
    );
  });
});
