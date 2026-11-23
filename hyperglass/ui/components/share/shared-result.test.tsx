import { screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, testConfig } from '~/__tests__/render';
import { useShareView } from '~/hooks';
import { SharedResult } from './shared-result';

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: false, pathname: '/', replace: vi.fn() }),
}));

afterEach(() => {
  useShareView.setState({ id: null });
  vi.unstubAllGlobals();
});

describe('SharedResult', () => {
  it('renders the loading region empty at first, then fills it, so screen readers announce it', async () => {
    // A live region is announced when its content changes, not when it appears with it.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    useShareView.setState({ id: '0123456789abcdef0123456789abcdef' });
    const atFirstCommit: (string | null)[] = [];
    // A parent's layout effect runs after its children are in the DOM, before any effect.
    const Probe = (): JSX.Element => {
      useLayoutEffect(() => {
        atFirstCommit.push(document.querySelector('[role="status"]')?.textContent ?? null);
      }, []);
      return <SharedResult />;
    };
    renderWithProviders(<Probe />);

    expect(atFirstCommit).toEqual(['']);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(testConfig.web.text.shareLoading),
    );
  });
});
