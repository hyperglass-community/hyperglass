import { screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { describe, expect, it } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { Controls } from './controls';

/**
 * Render the controls and wait for their icons. The icons load through `next/dynamic`,
 * so waiting for them makes every run cover the same code.
 */
async function renderControls(options: Parameters<typeof renderWithProviders>[1] = {}) {
  const result = renderWithProviders(
    <ReactFlowProvider>
      <Controls />
    </ReactFlowProvider>,
    options,
  );
  await waitFor(
    () => expect(result.container.querySelectorAll('button svg')).toHaveLength(3),
    IMPORT_WAIT,
  );
  return result;
}

describe('Controls', () => {
  it('names each button from web.text', async () => {
    await renderControls();

    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'Zoom In' }),
      screen.getByRole('button', { name: 'Zoom Out' }),
      screen.getByRole('button', { name: 'Fit Nodes' }),
    ]);
  });

  // #541: the names were hard-coded English.
  it('uses the configured text', async () => {
    const config = makeConfig({
      web: { text: { zoomIn: 'Agrandir', zoomOut: 'Réduire', fitNodes: 'Tout afficher' } },
    });
    await renderControls({ config });

    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'Agrandir' }),
      screen.getByRole('button', { name: 'Réduire' }),
      screen.getByRole('button', { name: 'Tout afficher' }),
    ]);
  });
});
