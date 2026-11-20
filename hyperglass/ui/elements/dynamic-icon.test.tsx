import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, renderWithProviders } from '~/__tests__/render';
import { DynamicIcon } from './dynamic-icon';

// The icon module loads through an async `next/dynamic` import. Each test waits for
// it to settle, so the code after the import always runs and coverage is the same
// on every run.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DynamicIcon', () => {
  it.each([
    ['full name', { fa: 'FaPlus' }],
    ['name without the family prefix', { fa: 'plus' }],
    ['lower-case name with the family prefix', { fa: 'faplus' }],
  ])('renders an icon from its %s', async (_, icon) => {
    const { container } = renderWithProviders(<DynamicIcon icon={icon} data-testid="icon" />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  });

  it('renders the error icon for an icon the library does not have', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(<DynamicIcon icon={{ fa: 'FaNoSuchIcon' }} />);
    expect(await screen.findByText('⚠', {}, IMPORT_WAIT)).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "No icon matches 'react-icons/fa/FaNoSuchIcon'" }),
    );
  });

  it('renders the error icon for a library that does not exist', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(<DynamicIcon icon={{ zz: 'ZzPlus' }} />);
    expect(await screen.findByText('⚠', {}, IMPORT_WAIT)).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });
});
