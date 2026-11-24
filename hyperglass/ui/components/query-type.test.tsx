import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Directive, OnChangeArgs } from '~/types';

// `QueryType` keeps the chosen group filter in a module-level zustand store that it does
// not export. Each test loads fresh modules, so that store, and `useFormState`, start
// empty. The render helper is loaded the same way, so the component and the providers
// share one configuration context.

type Modules = {
  QueryType: typeof import('./query-type').QueryType;
  useFormState: typeof import('~/hooks').useFormState;
  renderWithProviders: typeof import('~/__tests__/render').renderWithProviders;
  testConfig: typeof import('~/__tests__/render').testConfig;
};

let m: Modules;

beforeEach(async () => {
  vi.resetModules();
  const [{ QueryType }, { useFormState }, { renderWithProviders, testConfig }] = await Promise.all([
    import('./query-type'),
    import('~/hooks'),
    import('~/__tests__/render'),
  ]);
  m = { QueryType, useFormState, renderWithProviders, testConfig };
});

const LABEL = 'Query Type';

/** The fixture's Router One directives, with the given groups by position. */
function directives(groups: string[][] = []): Directive[] {
  const dev = m.testConfig.devices.flatMap(g => g.locations).find(d => d.id === 'router_one');
  if (dev === undefined) {
    throw new Error('No router_one in the fixture');
  }
  return dev.directives.map((d, i) => ({ ...d, groups: groups[i] ?? [] }));
}

function setFiltered(types: Directive[], groups: string[] = []): void {
  act(() => m.useFormState.setState({ filtered: { types, groups } }));
}

/** `QueryType` inside a react-hook-form context, as the form renders it. */
function renderQueryType(onChange = vi.fn<(e: OnChangeArgs) => void>(), error = false) {
  const Form = (): JSX.Element => {
    const methods = useForm();
    const { setError } = methods;
    useEffect(() => {
      if (error) {
        setError('queryType', { message: 'missing' });
      }
    }, [setError]);
    return (
      <FormProvider {...methods}>
        <m.QueryType onChange={onChange} label={LABEL} />
        <output>{'queryType' in methods.formState.errors ? 'has error' : 'no error'}</output>
      </FormProvider>
    );
  };
  const result = m.renderWithProviders(<Form />);
  return { ...result, onChange };
}

async function openMenu(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('combobox', { name: LABEL }));
  return waitFor(() => {
    const menu = document.querySelector<HTMLElement>('[id$="-listbox"]');
    if (menu === null) {
      throw new Error('No open menu');
    }
    return menu;
  });
}

function optionLabels(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[id*="-option-"]')).map(o => o.textContent ?? '');
}

/**
 * The group filter radios. The visible buttons are hidden from the accessibility tree and
 * the radio inputs have no name, so they are found by their input name.
 */
function groupRadios(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="queryGroup"]'),
  );
}

async function chooseGroup(value: string): Promise<void> {
  const radio = groupRadios().find(r => r.value === value);
  // The click handler is on the button next to the radio input.
  await userEvent.click(radio?.nextElementSibling as HTMLElement);
}

describe('QueryType', () => {
  it('lists the filtered directives by name', async () => {
    setFiltered(directives());
    renderQueryType();

    const menu = await openMenu();

    expect(optionLabels(menu)).toEqual([
      'BGP AS Path',
      'BGP Community',
      'BGP Route',
      'Ping',
      'Traceroute',
    ]);
    // Without groups there is no group filter.
    expect(groupRadios()).toEqual([]);
  });

  it('records the selection and reports the directive ID', async () => {
    setFiltered(directives());
    const { onChange } = renderQueryType();

    await userEvent.click(within(await openMenu()).getByText('Ping'));

    expect(onChange).toHaveBeenCalledWith({
      field: 'queryType',
      value: '__hyperglass_juniper_ping__',
    });
    expect(m.useFormState.getState().selections.queryType).toMatchObject({
      label: 'Ping',
      value: '__hyperglass_juniper_ping__',
    });
    expect(screen.getByText('Ping')).toBeInTheDocument();
  });

  it('clears the selection and the form value when cleared', async () => {
    setFiltered(directives());
    const { onChange, container } = renderQueryType();
    await userEvent.click(within(await openMenu()).getByText('Ping'));
    act(() => m.useFormState.getState().setFormValue('queryType', '__hyperglass_juniper_ping__'));

    const clear = container.querySelector('[class*="indicatorContainer"]');
    if (clear === null) {
      throw new Error('No clear indicator');
    }
    await userEvent.click(clear);

    expect(onChange).toHaveBeenLastCalledWith({ field: 'queryType', value: '' });
    expect(m.useFormState.getState().selections.queryType).toBeNull();
    expect(m.useFormState.getState().form.queryType).toBe('');
  });

  it('groups directives under their group names, sorted', async () => {
    setFiltered(directives([['Routing'], ['Routing'], ['Routing'], ['Tools'], ['Tools']]), [
      'Routing',
      'Tools',
    ]);
    renderQueryType();

    const menu = await openMenu();

    const headings = Array.from(menu.querySelectorAll('[id$="-heading"]')).map(h => h.textContent);
    expect(headings).toEqual(['Routing', 'Tools']);
    expect(optionLabels(menu)).toEqual([
      'BGP AS Path',
      'BGP Community',
      'BGP Route',
      'Ping',
      'Traceroute',
    ]);
  });

  it('shows a group filter for each group, with None chosen', async () => {
    setFiltered(directives([['IPv4'], ['IPv6']]), ['IPv4', 'IPv6']);
    renderQueryType();

    await openMenu();

    expect(await screen.findByText('None')).toBeInTheDocument();
    expect(groupRadios().map(r => r.value)).toEqual(['', 'IPv4', 'IPv6']);
    expect(groupRadios().find(r => r.value === '')).toBeChecked();
  });

  it('shows only the directives of the chosen group, and all of them again for None', async () => {
    setFiltered(directives([['IPv4'], ['IPv6']]), ['IPv4', 'IPv6']);
    renderQueryType();
    const menu = await openMenu();

    await chooseGroup('IPv6');

    expect(groupRadios().find(r => r.value === 'IPv6')).toBeChecked();
    expect(optionLabels(menu)).toEqual(['BGP AS Path']);

    await chooseGroup('');

    // Ungrouped directives first, then each group.
    expect(optionLabels(menu)).toEqual([
      'BGP Community',
      'Ping',
      'Traceroute',
      'BGP Route',
      'BGP AS Path',
    ]);
  });

  it('matches typed text against the option and its group name', async () => {
    setFiltered(directives([['IPv4'], ['IPv6']]), ['IPv4', 'IPv6']);
    renderQueryType();
    const menu = await openMenu();

    await userEvent.keyboard('trace');
    expect(optionLabels(menu)).toEqual(['Traceroute']);

    await userEvent.clear(screen.getByRole('combobox', { name: LABEL }));
    await userEvent.keyboard('ipv4');
    expect(optionLabels(menu)).toEqual(['BGP Route']);
  });

  // #513: the select's style hooks read `isError` from a context the same component
  // provided, so an invalid query type looked valid.
  it('marks the select invalid when the form has a query type error', async () => {
    setFiltered(directives());
    const valid = renderQueryType();
    const invalid = renderQueryType(undefined, true);

    expect(await within(invalid.container).findByText('has error')).toBeInTheDocument();
    expect(within(valid.container).getByText('no error')).toBeInTheDocument();
    const combobox = (root: HTMLElement): HTMLElement =>
      within(root).getByRole('combobox', { name: LABEL });
    expect(combobox(invalid.container)).toHaveAttribute('aria-invalid', 'true');
    expect(combobox(valid.container)).not.toHaveAttribute('aria-invalid');

    const border = (root: HTMLElement): string => {
      const control = combobox(root).closest<HTMLElement>('[class*="-control"]');
      if (control === null) {
        throw new Error('No control');
      }
      return getComputedStyle(control).borderColor;
    };
    expect(border(invalid.container)).not.toBe(border(valid.container));
  });
});
