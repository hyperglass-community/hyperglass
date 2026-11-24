import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** The width, in pixels, of `px` or `em` in a media query (1em = 16px). */
function toPx(value: string, unit: string): number {
  return unit === 'em' ? Number(value) * 16 : Number(value);
}

/**
 * Report a 1280 px wide viewport, where the table shows its page size select. jsdom has
 * no layout, and its stub `matchMedia` matches nothing, so the table is a phone otherwise.
 */
function desktop(width = 1280): void {
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => {
    const min = /min-width:\s*([\d.]+)(px|em)/.exec(query);
    const max = /max-width:\s*([\d.]+)(px|em)/.exec(query);
    const matches =
      (min === null || width >= toPx(min[1], min[2])) &&
      (max === null || width <= toPx(max[1], max[2]));
    return { ...original(query), matches };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    const page = (n: number) => screen.getByText(`Page ${n} of 3`);

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

  // #548: the page size select had no name, and its options and the page count were
  // fixed English.
  it('names the page size select and its options from web.text', async () => {
    desktop();
    await renderTable();

    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    // #548: it shows the table's page size, 50 rows; it dropped its value and showed 5.
    expect(select).toHaveDisplayValue('Show 50');
    expect(
      within(select)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual(['Show 5', 'Show 10', 'Show 20', 'Show 30', 'Show 40', 'Show 50']);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('shows the page count without the select on a phone', async () => {
    await renderTable();

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('changes the page size from the select', async () => {
    desktop();
    await renderTable();

    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    await userEvent.selectOptions(select, screen.getByRole('option', { name: 'Show 20' }));

    expect(select).toHaveDisplayValue('Show 20');

    expect(screen.getByText('Page 1 of 6')).toBeInTheDocument();
    expect(screen.getByText('row 20')).toBeInTheDocument();
    expect(screen.queryByText('row 21')).not.toBeInTheDocument();
  });

  it('uses the configured text', async () => {
    const config = makeConfig({
      web: {
        text: {
          firstPage: 'Première page',
          previousPage: 'Page précédente',
          nextPage: 'Page suivante',
          lastPage: 'Dernière page',
          pageSize: 'Lignes par page',
          pageSizeOption: '{count} lignes',
          pageCount: 'Page {page} sur {pages}',
        },
      },
    });
    desktop();
    await renderTable({ config });

    for (const name of ['Première page', 'Page précédente', 'Page suivante', 'Dernière page']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    const select = screen.getByRole('combobox', { name: 'Lignes par page' });
    expect(within(select).getByRole('option', { name: '20 lignes' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 sur 3')).toBeInTheDocument();
  });
});
