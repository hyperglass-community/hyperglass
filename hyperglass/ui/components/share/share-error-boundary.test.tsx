import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, testConfig } from '~/__tests__/render';
import { ShareErrorBoundary } from './share-error-boundary';

const Throws = (): JSX.Element => {
  throw new TypeError("Cannot read properties of undefined (reading 'map')");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShareErrorBoundary', () => {
  it('shows its children', () => {
    renderWithProviders(
      <ShareErrorBoundary message="failed">
        <p>shared output</p>
      </ShareErrorBoundary>,
    );
    expect(screen.getByText('shared output')).toBeInTheDocument();
  });

  it('shows the message instead of a result that fails to render, and keeps the page', () => {
    // React logs the caught error.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <>
        <h2>still here</h2>
        <ShareErrorBoundary message={testConfig.web.text.shareError}>
          <Throws />
        </ShareErrorBoundary>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(testConfig.web.text.shareError);
    expect(screen.getByRole('heading', { name: 'still here' })).toBeInTheDocument();
    expect(screen.queryByText(/reading 'map'/)).not.toBeInTheDocument();
  });
});
