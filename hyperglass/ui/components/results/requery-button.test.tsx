import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { RequeryButton } from './requery-button';

import type { UseQueryResult } from '@tanstack/react-query';

type Requery = UseQueryResult<QueryResponse>['refetch'];

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Render the button and wait for its icon. The icon loads through `next/dynamic`, so
 * waiting for it makes every run cover the same code.
 */
async function renderButton(props: Partial<React.ComponentProps<typeof RequeryButton>> = {}) {
  const requery = vi.fn() as unknown as Requery;
  const result = renderWithProviders(
    <RequeryButton requery={requery} data-testid="requery" {...props} />,
  );
  await waitFor(() => expect(result.container.querySelector('svg')).toBeInTheDocument());
  return { ...result, requery, button: screen.getByTestId('requery') };
}

describe('RequeryButton', () => {
  it('runs the query again on click', async () => {
    const { button, requery } = await renderButton();

    await userEvent.click(button);

    expect(requery).toHaveBeenCalledTimes(1);
  });

  it('shows a tooltip on hover', async () => {
    const { button } = await renderButton();

    await userEvent.hover(button);

    expect(await screen.findByRole('tooltip', { name: 'Reload Query' })).toBeInTheDocument();
  });

  it('is marked disabled while a query runs', async () => {
    const { button } = await renderButton({ isDisabled: true });

    expect(button).toHaveAttribute('disabled');
  });

  // The button renders as an `<a>`, where `disabled` has no effect, so a click while a
  // query runs still calls `requery`. Enable this once the button ignores those clicks.
  it.todo('ignores clicks while disabled');

  it('forwards its ref to the button element', async () => {
    const ref = createRef<HTMLButtonElement>();
    const { button } = await renderButton({ ref });

    expect(ref.current).toBe(button);
  });
});
