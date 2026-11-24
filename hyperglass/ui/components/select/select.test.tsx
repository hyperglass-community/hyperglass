import { FormControl, FormErrorMessage, useToken } from '@chakra-ui/react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { classRules, lastValue } from '~/__tests__/styles';
import { Select } from './select';

import type { SingleOption } from '~/types';

const options: SingleOption[] = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
];

/** The theme's `red.500`, the error border in light mode, shown for the test to read. */
const ErrorColor = (): JSX.Element => <output>{useToken('colors', 'red.500')}</output>;

/** Render the select and return the theme's error color. */
function renderSelect(isError: boolean) {
  const result = renderWithProviders(
    <>
      <Select<SingleOption, false>
        name="test"
        aria-label="Test"
        options={options}
        isError={isError}
      />
      <ErrorColor />
    </>,
  );
  const red = screen.getByRole('status').textContent ?? '';
  expect(red).toMatch(/^#/);
  return { ...result, red };
}

/** The react-select control around the combobox, which draws the border. */
function control(): HTMLElement {
  const found = screen
    .getByRole('combobox', { name: 'Test' })
    .closest<HTMLElement>('[class*="-control"]');
  if (found === null) {
    throw new Error('No control');
  }
  return found;
}

describe('Select', () => {
  // #513: the style hooks read `isError` from a context the same component provided,
  // so they always saw the default and an invalid select looked valid.
  it('draws the error border when it has an error', () => {
    const { red } = renderSelect(true);

    // The control's own rule, and the hover rule after it.
    const base = classRules(control());
    expect(lastValue(base, 'border-color')).toBe(red);
    expect(lastValue(base, 'box-shadow')).toBe(`0 0 0 1px ${red}`);
    expect(lastValue(classRules(control(), [':hover']), 'border-color')).toBe(red);
  });

  it('draws no error border without an error', () => {
    const { red } = renderSelect(false);

    const base = classRules(control());
    expect(lastValue(base, 'border-color')).not.toBe(red);
    expect(lastValue(base, 'box-shadow')).toBeNull();
    expect(lastValue(classRules(control(), [':hover']), 'border-color')).not.toBe(red);
  });

  it('marks the combobox invalid only when it has an error', () => {
    const { unmount } = renderSelect(true);
    expect(screen.getByRole('combobox', { name: 'Test' })).toHaveAttribute('aria-invalid', 'true');
    unmount();

    renderSelect(false);
    expect(screen.getByRole('combobox', { name: 'Test' })).not.toHaveAttribute('aria-invalid');
  });

  it("is described by its field's error message while it has an error", () => {
    const Field = ({ isError }: { isError: boolean }): JSX.Element => (
      <FormControl isInvalid={isError}>
        <Select<SingleOption, false>
          name="test"
          aria-label="Test"
          options={options}
          isError={isError}
        />
        <FormErrorMessage>Test is required.</FormErrorMessage>
      </FormControl>
    );
    const { rerender } = renderWithProviders(<Field isError />);

    const combobox = screen.getByRole('combobox', { name: 'Test' });
    const message = screen.getByText('Test is required.');
    expect(combobox).toHaveAttribute('aria-errormessage', message.id);
    expect(combobox.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
    expect(combobox).toHaveAccessibleDescription(expect.stringContaining('Test is required.'));

    rerender(<Field isError={false} />);
    expect(screen.queryByText('Test is required.')).not.toBeInTheDocument();
    expect(combobox).not.toHaveAttribute('aria-errormessage');
    expect(combobox.getAttribute('aria-describedby') ?? '').not.toContain('feedback');
  });

  it('refers to no error message outside a form field', () => {
    renderSelect(true);

    expect(screen.getByRole('combobox', { name: 'Test' })).not.toHaveAttribute('aria-errormessage');
  });
});
