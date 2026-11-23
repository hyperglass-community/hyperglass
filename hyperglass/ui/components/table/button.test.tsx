import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { TableIconButton } from './button';

describe('TableIconButton', () => {
  // #541: a fixed "Table Icon Button" label replaced the caller's.
  it('is named by the aria-label it is given', () => {
    renderWithProviders(<TableIconButton aria-label="Next Page" icon={<svg />} />);

    expect(screen.getByRole('button', { name: 'Next Page' })).toBeInTheDocument();
  });
});
