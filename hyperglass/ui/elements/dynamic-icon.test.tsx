import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { DynamicIcon } from './dynamic-icon';

// The icon module loads through an async `next/dynamic` import. Each test waits for
// it to settle, so the code after the import always runs and coverage is the same
// on every run. The first import of an icon library is slow under coverage, so the
// waits allow more than the 1 s default.
const LOAD = { timeout: 10_000 };

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
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument(), LOAD);
  });

  it('renders the error icon for an icon the library does not have', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(<DynamicIcon icon={{ fa: 'FaNoSuchIcon' }} />);
    expect(await screen.findByText('⚠', {}, LOAD)).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "No icon matches 'react-icons/fa/FaNoSuchIcon'" }),
    );
  });

  it('renders the error icon for a library that does not exist', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(<DynamicIcon icon={{ zz: 'ZzPlus' }} />);
    expect(await screen.findByText('⚠', {}, LOAD)).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });
});
