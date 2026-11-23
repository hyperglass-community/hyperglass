import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeConfig, renderWithProviders } from '~/__tests__/render';
import { useFormState, useHistoryView, useQueryHistory } from '~/hooks';
import { Title } from './title';

afterEach(() => {
  vi.unstubAllGlobals();
  useQueryHistory.setState({ entries: [] });
  useHistoryView.setState({ openId: null, returnFocusId: null });
  localStorage.clear();
});

/** An `Image` whose every load succeeds, as a browser's would once the logo arrives. */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

describe('Title', () => {
  // In `logo_only` mode the button's only content is the logo. Until the logo loads,
  // or if it fails to, the logo is a placeholder, which had no text alternative.
  it('names the logo-only button while the logo loads', () => {
    renderWithProviders(<Title />);

    expect(screen.getByRole('button', { name: 'Hyperglass' })).toBeInTheDocument();
  });

  it('names the logo-only button from the logo once it loads', async () => {
    vi.stubGlobal('Image', LoadingImage);
    renderWithProviders(<Title />);

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Hyperglass' }).tagName).toBe('IMG'),
    );
    expect(screen.getByRole('button', { name: 'Hyperglass' })).toBeInTheDocument();
  });

  it('uses the configured title', () => {
    const config = makeConfig({ web: { text: { title: 'Example AS65000' } } });
    renderWithProviders(<Title />, { config });

    expect(screen.getByRole('button', { name: 'Example AS65000' })).toBeInTheDocument();
  });

  it('goes back through the browser history entry of an opened history entry', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    window.history.replaceState({ ultraglass: 'history' }, '');
    useHistoryView.setState({ openId: 'saved' });
    renderWithProviders(<Title />);

    await userEvent.click(screen.getByRole('button', { name: 'Hyperglass' }));

    expect(back).toHaveBeenCalledTimes(1);
    // The popstate event that follows closes it (see `Layout`).
    expect(useHistoryView.getState().openId).toBe('saved');
    window.history.replaceState(null, '');
  });

  it('returns to an empty form from an opened history entry', async () => {
    useHistoryView.setState({ openId: 'saved' });
    renderWithProviders(<Title />);

    await userEvent.click(screen.getByRole('button', { name: 'Hyperglass' }));

    expect(useHistoryView.getState().openId).toBeNull();
    expect(useFormState.getState().status).toBe('form');
  });
});
