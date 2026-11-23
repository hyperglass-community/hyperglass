import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { CopyLinkButton } from './copy-link-button';

const LINK =
  'https://lg.example.net/lg/?location=router_one&location=router_two&type=__hyperglass_juniper_bgp_route__&target=2001%3Adb8%3A%3A%2F32';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** Replace `navigator.clipboard`; `undefined` removes it, as outside a secure context. */
function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

let alert: ReturnType<typeof vi.fn>;
let prompt: ReturnType<typeof vi.fn>;

beforeEach(() => {
  alert = vi.fn();
  prompt = vi.fn();
  vi.stubGlobal('alert', alert);
  vi.stubGlobal('prompt', prompt);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (original === undefined) {
    // jsdom has no clipboard of its own.
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', original);
  }
});

/**
 * Render the button and wait for its icon. The icon loads through `next/dynamic`, so
 * waiting for it makes every run cover the same code.
 */
async function renderButton(options: Parameters<typeof renderWithProviders>[1] = {}) {
  const result = renderWithProviders(<CopyLinkButton link={LINK} />, options);
  await waitFor(
    () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
  return { ...result, button: screen.getByRole('button', { name: 'Copy Link' }) };
}

/** The read-only field that shows the link when it can't be copied. */
function fallbackField(): HTMLInputElement | null {
  return screen.queryByRole('textbox', { name: 'Link to this query' });
}

describe('CopyLinkButton', () => {
  it('copies the link and confirms it', async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    const { button } = await renderButton();

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await userEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(LINK);
    // The confirmation is in a live region, so a screen reader announces it.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied'));
    expect(fallbackField()).toBeNull();
  });

  it('shows the link in a read-only, labelled field when there is no clipboard', async () => {
    setClipboard(undefined);
    const { button } = await renderButton();

    await userEvent.click(button);

    const field = await waitFor(() => {
      const found = fallbackField();
      expect(found).not.toBeNull();
      return found as HTMLInputElement;
    });
    expect(field).toHaveValue(LINK);
    expect(field).toHaveAttribute('readonly');
    // Focused and selected, ready to copy by hand.
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
    expect(screen.getByRole('status')).not.toHaveTextContent('Link copied');
    expect(alert).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('shows the link in the field when the clipboard refuses it', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('Write permission denied.', 'NotAllowedError');
    });
    setClipboard({ writeText });
    const { button } = await renderButton();

    await userEvent.click(button);

    await waitFor(() => expect(fallbackField()).toHaveValue(LINK));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('status')).not.toHaveTextContent('Link copied');
    expect(alert).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('can be reached and pressed with the keyboard', async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    const { button } = await renderButton();

    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  // The button's only content is an icon (#533).
  it('is a button named by web.text.copyLink', async () => {
    setClipboard(undefined);
    const { button } = await renderButton();

    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAccessibleName('Copy Link');
  });

  it('uses the configured text', async () => {
    setClipboard(undefined);
    const config = makeConfig({
      web: {
        text: { copyLink: 'Copier le lien', linkCopied: 'Lien copié', queryLink: 'Lien' },
      },
    });
    const result = renderWithProviders(<CopyLinkButton link={LINK} />, { config });
    await waitFor(
      () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
      IMPORT_WAIT,
    );
    const button = screen.getByRole('button', { name: 'Copier le lien' });

    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip', { name: 'Copier le lien' })).toBeInTheDocument();

    await userEvent.click(button);
    expect(await screen.findByRole('textbox', { name: 'Lien' })).toHaveValue(LINK);
  });

  it('confirms with the configured text', async () => {
    setClipboard({ writeText: vi.fn(async () => undefined) });
    const config = makeConfig({ web: { text: { linkCopied: 'Lien copié' } } });
    const { button } = await renderButton({ config });

    await userEvent.click(button);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lien copié'));
  });
});
