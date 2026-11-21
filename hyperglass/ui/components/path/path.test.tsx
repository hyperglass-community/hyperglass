import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { Path } from './path';

// The chart needs a layout engine that jsdom lacks, and the heading does not depend on it.
vi.mock('./chart', () => ({ Chart: () => null }));

const response = {
  output: {
    vrf: 'default',
    count: 1,
    routes: [{ prefix: '192.0.2.0/24', as_path: [65000, 64999], rpki_state: 3 }],
    winning_weight: 'high',
    asn_organizations: {},
  },
} as unknown as QueryResponse;

/** Render the AS path for `target`, open the modal and return it. */
async function openPath(target: string, options: Parameters<typeof renderWithProviders>[1] = {}) {
  const result = renderWithProviders(<Path response={response} displayTarget={target} />, options);
  await waitFor(
    () => expect(result.container.querySelector('button svg')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
  await userEvent.click(screen.getByRole('button', { name: result.config.web.text.viewAsPath }));
  return screen.findByRole('dialog');
}

describe('Path', () => {
  it('titles the modal with web.text.asPathTitle and the target', async () => {
    const dialog = await openPath('192.0.2.0/24');

    expect(dialog).toHaveAccessibleName('Path to 192.0.2.0/24');
  });

  it('substitutes an IPv6 target', async () => {
    const dialog = await openPath('2001:db8::/32');

    expect(dialog).toHaveAccessibleName('Path to 2001:db8::/32');
  });

  // #541: the heading was hard-coded English.
  it('uses the configured text', async () => {
    const config = makeConfig({ web: { text: { asPathTitle: 'Chemin vers {target}' } } });
    const dialog = await openPath('2001:db8::/32', { config });

    expect(dialog).toHaveAccessibleName('Chemin vers 2001:db8::/32');
  });
});
