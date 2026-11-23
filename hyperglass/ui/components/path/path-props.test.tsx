import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { useFormState } from '~/hooks';
import { Path } from './path';

// The chart needs a layout engine that jsdom lacks; the modal around it is what matters here.
vi.mock('./chart', () => ({ Chart: () => null }));

const initialFormState = useFormState.getState();

/** A BGP response without ASN organizations, which `Path` can look up when it opens. */
function response(): QueryResponse {
  return {
    output: {
      vrf: 'default',
      count: 1,
      routes: [{ prefix: '2001:db8::/32', as_path: [65000, 64999], rpki_state: 3 }],
      winning_weight: 'high',
      asn_organizations: {},
    },
  } as unknown as QueryResponse;
}

const organizations = { '65000': { name: 'Example Org', country: 'CA' } };

// Enrichment is on, so only the missing callback can stop the lookup.
const config = makeConfig({ web: { aspathEnrichment: true } });

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, asn_organizations: organizations }),
  }));
  vi.stubGlobal('fetch', fetch);
  useFormState.setState(initialFormState, true);
});

afterEach(() => {
  useFormState.setState(initialFormState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Open the AS path modal rendered by `ui` and return it. */
async function open(ui: React.ReactElement): Promise<HTMLElement> {
  const { container } = renderWithProviders(ui, { config });
  const button = container.querySelector('.chakra-button') as HTMLElement;
  await waitFor(() => expect(button.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  await userEvent.click(button);
  return screen.findByRole('dialog');
}

describe('Path', () => {
  it('renders from props with no form state and makes no request without onEnriched', async () => {
    const dialog = await open(<Path response={response()} displayTarget="2001:db8::/32" />);

    expect(dialog).toHaveAccessibleName('Path to 2001:db8::/32');
    expect(fetch).not.toHaveBeenCalled();
    expect(useFormState.getState().responses).toEqual({});
  });

  it('looks up ASN organizations and passes the enriched response to onEnriched', async () => {
    const onEnriched = vi.fn();
    await open(
      <Path response={response()} displayTarget="2001:db8::/32" onEnriched={onEnriched} />,
    );

    await waitFor(() => expect(onEnriched).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/aspath/enrich');
    expect(JSON.parse(init.body as string)).toEqual({ as_path: ['65000', '64999'] });
    const [enriched] = onEnriched.mock.calls[0] as [QueryResponse];
    expect((enriched.output as StructuredResponse).asn_organizations).toEqual(organizations);
  });
});
