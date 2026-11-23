import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { Table } from './main';

import type { TableColumn } from '~/types';

interface Row {
  name: string;
}

const columns: TableColumn<Row>[] = [
  { Header: 'Name', accessor: 'name', align: 'left', hidden: false },
];

// The table shows 50 rows per page, so 120 rows make three pages.
const data: Row[] = Array.from({ length: 120 }, (_, i) => ({ name: `row ${i + 1}` }));

/**
 * Render the table and wait for the pagination icons. The icons load through
 * `next/dynamic`, so waiting for them makes every run cover the same code.
 */
async function renderTable(options: Parameters<typeof renderWithProviders>[1] = {}) {
  const result = renderWithProviders(<Table<Row> data={data} columns={columns} />, options);
  await waitFor(
    () => expect(result.container.querySelectorAll('button svg')).toHaveLength(4),
    IMPORT_WAIT,
  );
  return result;
}

describe('Table pagination', () => {
  // #541: all four buttons were named "Table Icon Button".
  it('names each page button from web.text', async () => {
    await renderTable();

    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'First Page' }),
      screen.getByRole('button', { name: 'Previous Page' }),
      screen.getByRole('button', { name: 'Next Page' }),
      screen.getByRole('button', { name: 'Last Page' }),
    ]);
  });

  it('moves to the page each button is named for', async () => {
    await renderTable();
    const page = (n: number) => screen.getByText(`${n} of 3`);

    expect(page(1)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    expect(page(2)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Last Page' }));
    expect(page(3)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous Page' }));
    expect(page(2)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'First Page' }));
    expect(page(1)).toBeInTheDocument();
  });

  it('uses the configured text', async () => {
    const config = makeConfig({
      web: {
        text: {
          firstPage: 'Première page',
          previousPage: 'Page précédente',
          nextPage: 'Page suivante',
          lastPage: 'Dernière page',
        },
      },
    });
    await renderTable({ config });

    for (const name of ['Première page', 'Page précédente', 'Page suivante', 'Dernière page']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
