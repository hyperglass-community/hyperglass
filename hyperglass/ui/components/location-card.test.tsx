import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { LocationCard } from './location-card';

import type { SingleOption } from '~/types';

const option: SingleOption = { value: 'router_one', label: 'Router One' };

function card(): HTMLElement {
  const found = screen.getByText('Router One').closest<HTMLElement>('[data-checked]');
  if (found === null) {
    throw new Error('No card');
  }
  return found;
}

describe('LocationCard', () => {
  it('shows the checked state it is given', () => {
    const { rerender } = renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={vi.fn()} hasError={false} />,
    );
    expect(card()).toHaveAttribute('data-checked', 'false');

    rerender(<LocationCard option={option} isChecked onChange={vi.fn()} hasError={false} />);
    expect(card()).toHaveAttribute('data-checked', 'true');
  });

  it('asks to add an unchecked location once per click', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={onChange} hasError={false} />,
    );

    await userEvent.click(screen.getByText('Router One'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('add', option);
    // The card doesn't change by itself: the store decides.
    expect(card()).toHaveAttribute('data-checked', 'false');
  });

  it('asks to remove a checked location once per click', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <LocationCard option={option} isChecked onChange={onChange} hasError={false} />,
    );

    await userEvent.click(screen.getByText('Router One'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('remove', option);
  });
});
