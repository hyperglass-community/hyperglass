import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { PathButton } from './path-button';

/**
 * Render the button and wait for its icon. The icon loads through `next/dynamic`, so
 * waiting for it makes every run cover the same code.
 */
async function renderButton(options: Parameters<typeof renderWithProviders>[1] = {}) {
  const onOpen = vi.fn();
  const result = renderWithProviders(<PathButton onOpen={onOpen} />, options);
  await waitFor(
    () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
  return { ...result, onOpen };
}

describe('PathButton', () => {
  // #533: the button's only content is an icon, and the tooltip text reaches assistive
  // technology only while the tooltip is open.
  it('is a button named by web.text.viewAsPath', async () => {
    await renderButton();

    const button = screen.getByRole('button', { name: 'View AS Path' });
    expect(button.tagName).toBe('BUTTON');
  });

  it('opens the AS path on click', async () => {
    const { onOpen } = await renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'View AS Path' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // #533: as an `<a>` without an `href`, the button was not in the tab order.
  it('can be reached and pressed with the keyboard', async () => {
    const { onOpen } = await renderButton();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'View AS Path' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('uses the configured text for its name and tooltip', async () => {
    const config = makeConfig({ web: { text: { viewAsPath: 'Voir le chemin AS' } } });
    await renderButton({ config });

    const button = screen.getByRole('button', { name: 'Voir le chemin AS' });
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip', { name: 'Voir le chemin AS' })).toBeInTheDocument();
  });
});
