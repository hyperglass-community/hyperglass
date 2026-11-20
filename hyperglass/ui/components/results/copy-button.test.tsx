import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, renderWithProviders } from '~/__tests__/render';
import { CopyButton } from './copy-button';

const onCopy = vi.fn();

// jsdom has no clipboard, so record the copy instead of performing it.
vi.mock('@chakra-ui/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@chakra-ui/react')>()),
  useClipboard: () => ({ onCopy, hasCopied: false, value: '', setValue: vi.fn() }),
}));

afterEach(() => {
  onCopy.mockReset();
});

/**
 * Render the button and wait for its icon. The icon loads through `next/dynamic`, so
 * waiting for it makes every run cover the same code.
 */
async function renderButton(props: Partial<React.ComponentProps<typeof CopyButton>> = {}) {
  const result = renderWithProviders(
    <CopyButton copyValue="output" data-testid="copy" {...props} />,
  );
  await waitFor(
    () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
  return { ...result, button: screen.getByTestId('copy') };
}

describe('CopyButton', () => {
  it('copies the output on click', async () => {
    const { button } = await renderButton();

    await userEvent.click(button);

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  // #510: as an `<a>`, `disabled` had no effect, so a click while a query ran still
  // copied.
  it('ignores clicks while disabled', async () => {
    const { button } = await renderButton({ isDisabled: true });

    await userEvent.click(button);

    expect(onCopy).not.toHaveBeenCalled();
  });

  it('can be reached and pressed with the keyboard', async () => {
    const { button } = await renderButton();

    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
