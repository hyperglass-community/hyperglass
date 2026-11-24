import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { hasFocusRing } from '~/__tests__/styles';
import { LocationCard } from './location-card';

import type { SingleOption } from '~/types';

const option: SingleOption = {
  value: 'router_one',
  label: 'Router One',
  data: { description: 'First router' },
};

function card(): HTMLElement {
  return screen.getByRole('checkbox', { name: 'Router One' });
}

describe('LocationCard', () => {
  it('shows the checked state it is given', () => {
    const { rerender } = renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={vi.fn()} hasError={false} />,
    );
    expect(card()).not.toBeChecked();

    rerender(<LocationCard option={option} isChecked onChange={vi.fn()} hasError={false} />);
    expect(card()).toBeChecked();
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
    expect(card()).not.toBeChecked();
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

  // #573: the card was a `div` with only a click handler.
  it('is named by its location and described by its description', () => {
    renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={vi.fn()} hasError={false} />,
    );

    expect(card()).toHaveAccessibleName('Router One');
    expect(card()).toHaveAccessibleDescription('First router');
  });

  it('has no description without one', () => {
    renderWithProviders(
      <LocationCard
        option={{ value: 'router_two', label: 'Router Two' }}
        isChecked={false}
        onChange={vi.fn()}
        hasError={false}
      />,
    );

    const found = screen.getByRole('checkbox', { name: 'Router Two' });
    expect(found).not.toHaveAttribute('aria-describedby');
  });

  it('can be reached with Tab and toggled with Space and Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={onChange} hasError={false} />,
    );

    await user.tab();
    expect(card()).toHaveFocus();

    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('add', option);

    rerender(<LocationCard option={option} isChecked onChange={onChange} hasError={false} />);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('remove', option);
    expect(onChange).toHaveBeenCalledTimes(2);

    // Other keys do nothing.
    await user.keyboard('a{ArrowDown}');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps Space from scrolling the page', () => {
    renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={vi.fn()} hasError={false} />,
    );

    // `fireEvent` returns false when a handler called `preventDefault()`.
    expect(fireEvent.keyDown(card(), { key: ' ' })).toBe(false);
    expect(fireEvent.keyDown(card(), { key: ' ', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(card(), { key: 'Tab' })).toBe(true);
  });

  it('names the card without a heading, which a checkbox would hide', () => {
    renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={vi.fn()} hasError={false} />,
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('toggles once while a key is held down', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={onChange} hasError={false} />,
    );

    // user-event doesn't mark repeated key presses, so dispatch them directly.
    fireEvent.keyDown(card(), { key: ' ' });
    fireEvent.keyDown(card(), { key: ' ', repeat: true });
    fireEvent.keyDown(card(), { key: 'Enter', repeat: true });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('draws a focus ring for keyboard focus', () => {
    renderWithProviders(
      <LocationCard option={option} isChecked={false} onChange={vi.fn()} hasError={false} />,
    );

    expect(hasFocusRing(card())).toBe(true);
  });
});
