import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, renderWithProviders } from '~/__tests__/render';
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
  await waitFor(
    () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
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

  // #510: as an `<a>`, `disabled` had no effect and a click while a query ran still
  // called `requery`.
  it('ignores clicks while disabled', async () => {
    const { button, requery } = await renderButton({ isDisabled: true });

    await userEvent.click(button);

    expect(requery).not.toHaveBeenCalled();
  });

  it('can be reached and pressed with the keyboard', async () => {
    const { button, requery } = await renderButton();

    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(requery).toHaveBeenCalledTimes(1);
  });

  it('forwards its ref to the button element', async () => {
    const ref = createRef<HTMLButtonElement>();
    const { button } = await renderButton({ ref });

    expect(ref.current).toBe(button);
  });
});
