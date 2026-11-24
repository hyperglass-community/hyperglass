import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { useFormState, useGreeting } from '~/hooks';
import { LookingGlassForm } from './looking-glass-form';

import type { Config, Device, Directive } from '~/types';

// The form keeps its values in the global `useFormState` store and reads the greeting
// state from the persisted `useGreeting` store. Both are reset before each test, so no
// selection or acknowledgement leaks from one test to the next.

const { messages, web } = testConfig;

// The form reads the address once the Next.js router is ready. Outside Next.js there is
// no router: this stub is the index page's, ready unless a test says otherwise, and
// replaces the address as a shallow `replace` does.
const router = vi.hoisted(() => ({
  isReady: true,
  pathname: '/',
  replace: vi.fn(async (url: string, as?: string): Promise<boolean> => {
    window.history.replaceState(window.history.state, '', as ?? url);
    return true;
  }),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));

/** `messages.noInput` for a field label, as the form formats it. */
const noInput = (field: string): string => messages.noInput.replace('{field}', field);

/** The fixture device with this ID. */
function device(id: string): Device {
  const found = testConfig.devices.flatMap(g => g.locations).find(d => d.id === id);
  if (found === undefined) {
    throw new Error(`No device '${id}' in the fixture`);
  }
  return found;
}

/**
 * A configuration whose only location is a copy of the fixture's Router One, changed by
 * `update`. Arrays in `makeConfig` overrides replace the original, so the device list
 * is rebuilt here instead.
 */
function oneDeviceConfig(update: (dev: Device) => Device): Config {
  const dev = update(structuredClone(device('router_one')));
  return makeConfig({ devices: [{ group: 'North America', locations: [dev] }] } as never);
}

beforeEach(async () => {
  window.localStorage.clear();
  await act(async () => {
    await useFormState.getState().reset();
    useGreeting.setState({ isAck: false, isOpen: false, greetingReady: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Click the location card with this name. */
async function chooseLocation(name: string): Promise<void> {
  await userEvent.click(screen.getByText(name));
}

/**
 * The open react-select menu. Its options use a custom component without ARIA roles,
 * so the menu is found by the ID react-select gives it.
 */
async function openMenu(): Promise<HTMLElement> {
  return waitFor(() => {
    const menu = document.querySelector<HTMLElement>('[id$="-listbox"]');
    if (menu === null) {
      throw new Error('No open menu');
    }
    return menu;
  });
}

/** The option labels of the open menu, in order. */
async function menuLabels(): Promise<string[]> {
  const menu = await openMenu();
  return Array.from(menu.querySelectorAll('[id*="-option-"]')).map(o => o.textContent ?? '');
}

/** Open the query type menu and choose an option by its label. */
async function chooseQueryType(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('combobox', { name: web.text.queryType }));
  await userEvent.click(within(await openMenu()).getByText(name));
}

/** The text input for the target of a text-type directive. */
async function targetInput(placeholder = 'IP Address, Prefix, or Hostname'): Promise<HTMLElement> {
  return screen.findByPlaceholderText(placeholder);
}

function submit(container: HTMLElement): void {
  const form = container.querySelector('form');
  if (form === null) {
    throw new Error('No form element');
  }
  fireEvent.submit(form);
}

describe('LookingGlassForm rendering', () => {
  it('shows every configured location under its group, and no query type yet', () => {
    renderWithProviders(<LookingGlassForm />);

    expect(screen.getByText(web.text.queryLocation)).toBeInTheDocument();
    for (const group of testConfig.devices) {
      expect(screen.getByRole('heading', { name: group.group ?? '' })).toBeInTheDocument();
      for (const loc of group.locations) {
        expect(screen.getByText(loc.name)).toBeInTheDocument();
      }
    }
    expect(screen.queryByRole('combobox', { name: web.text.queryType })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/.+/)).not.toBeInTheDocument();
  });

  it('lists the query types of the selected location', async () => {
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router Three');

    await userEvent.click(await screen.findByRole('combobox', { name: web.text.queryType }));
    // Options are sorted by name.
    expect(await menuLabels()).toEqual([
      'BGP AS Path',
      'BGP Community',
      'BGP Route',
      'Peer Communities',
      'Ping',
      'Traceroute',
    ]);
    expect(useFormState.getState().form.queryLocation).toEqual(['router_three']);
  });

  it('only offers the query types every selected location has in common', async () => {
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseLocation('Router Three');

    await userEvent.click(await screen.findByRole('combobox', { name: web.text.queryType }));
    expect(await menuLabels()).toEqual([
      'BGP AS Path',
      'BGP Community',
      'BGP Route',
      'Ping',
      'Traceroute',
    ]);
    // Built-in directives match across platforms by name; the first location's IDs win.
    expect(useFormState.getState().filtered.types.map(t => t.id)).toEqual(
      device('router_one').directives.map(d => d.id),
    );
  });

  it('drops a location from the form when its card is clicked again', async () => {
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseLocation('Router Three');
    await chooseLocation('Router Three');

    expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
    expect(useFormState.getState().selections.queryLocation.map(s => s.value)).toEqual([
      'router_one',
    ]);
  });

  it('shows a text target input with the directive description as placeholder', async () => {
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP AS Path');

    const input = await targetInput('AS Path Regular Expression');
    expect(input).toHaveAttribute('name', 'queryTargetDisplay');
    expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_bgp_aspath__');
  });

  it('shows a select target with the options of a select directive', async () => {
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router Three');
    await chooseQueryType('Peer Communities');

    expect(screen.queryByPlaceholderText('Community')).not.toBeInTheDocument();
    const target = document.querySelector('input[name="queryTarget"]:not([hidden])');
    expect(target).not.toBeNull();
    // Open the target select (the second combobox) and choose an option.
    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.click(targetSelect);
    const menu = await openMenu();
    // The fixture's options have no name, so each option shows only its description.
    expect(within(menu).getByText('Customer routes')).toBeInTheDocument();
    await userEvent.click(within(menu).getByText('Peer routes'));

    expect(useFormState.getState().form.queryTarget).toEqual(['65000:1']);
    expect(useFormState.getState().target.display).toBe('65000:1');
  });

  it('removes a select target when the select is cleared', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router Three');
    await chooseQueryType('Peer Communities');
    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.click(targetSelect);
    await userEvent.click(within(await openMenu()).getByText('Peer routes'));
    // react-select's own form input holds the chosen option's value. The fixture's options
    // have no name, so the select shows no label to look for.
    const shown = (): string | undefined =>
      document.querySelector<HTMLInputElement>('input[name="queryTarget"]:not([hidden])')?.value;
    expect(shown()).toBe('65000:1');
    const control = targetSelect.closest<HTMLElement>('[class*="-control"]') as HTMLElement;

    const clear = control.querySelector('[class*="indicatorContainer"]');
    if (clear === null) {
      throw new Error('No clear indicator');
    }
    await userEvent.click(clear);

    expect(shown()).toBe('');
    expect(useFormState.getState().form.queryTarget).toEqual([]);
    expect(useFormState.getState().target.display).toBe('');
    // The target is required again.
    submit(container);
    expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('chooses the query type when the selected location has only one', async () => {
    const config = oneDeviceConfig(dev => ({ ...dev, directives: dev.directives.slice(3, 4) }));
    renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');

    expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_ping__');
    expect(await targetInput()).toBeInTheDocument();
  });

  it('shows and submits an automatically chosen query type', async () => {
    const config = oneDeviceConfig(dev => ({ ...dev, directives: dev.directives.slice(3, 4) }));
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');

    // The select shows the only query type.
    expect(useFormState.getState().selections.queryType).toEqual({
      value: '__hyperglass_juniper_ping__',
      label: 'Ping',
    });
    const select = await screen.findByRole('combobox', { name: web.text.queryType });
    const control = select.closest<HTMLElement>('[class*="-control"]');
    expect(within(control as HTMLElement).getByText('Ping')).toBeInTheDocument();

    await user.type(await targetInput(), '192.0.2.1');
    submit(container);

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(screen.queryByText(noInput(web.text.queryType))).not.toBeInTheDocument();
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_one'],
      queryType: '__hyperglass_juniper_ping__',
      queryTarget: ['192.0.2.1'],
      queryVariables: {},
    });
  });

  it('does not submit the previous query after the form is reset', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    await user.type(await targetInput(), '192.0.2.1');

    // The header title resets the store while the form stays mounted.
    await act(async () => {
      await useFormState.getState().reset();
    });
    submit(container);

    expect(await screen.findByText(noInput(web.text.queryLocation))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('hides the target field and fills it for a directive without a field type', async () => {
    const config = oneDeviceConfig(dev => ({
      ...dev,
      directives: [{ ...dev.directives[0], fieldType: null } as unknown as Directive],
    }));
    renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');

    await waitFor(() => expect(useFormState.getState().form.queryTarget).toEqual(['null']));
    expect(screen.queryByPlaceholderText(/.+/)).not.toBeInTheDocument();
  });

  it('clears the target when the query type changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    await user.type(await targetInput(), '192.0.2.1');
    expect(useFormState.getState().form.queryTarget).toEqual(['192.0.2.1']);

    await chooseQueryType('Ping');

    expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_ping__');
    expect(useFormState.getState().form.queryTarget).toEqual([]);
    expect(useFormState.getState().target.display).toBe('');
  });

  it('clears a query type the newly selected locations do not offer', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router Three');
    await chooseQueryType('Peer Communities');
    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.click(targetSelect);
    await userEvent.click(within(await openMenu()).getByText('Peer routes'));

    // Router One has no Peer Communities directive.
    await chooseLocation('Router One');

    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_three', 'router_one'],
      queryType: '',
      queryTarget: [],
      queryVariables: {},
    });
    const select = await screen.findByRole('combobox', { name: web.text.queryType });
    const control = select.closest<HTMLElement>('[class*="-control"]');
    expect(within(control as HTMLElement).queryByText('Peer Communities')).not.toBeInTheDocument();

    submit(container);

    expect(await screen.findByText(noInput(web.text.queryType))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('keeps the query type and target when the remaining location offers it by name', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseLocation('Router Three');
    await chooseQueryType('BGP Route');
    await user.type(await targetInput(), '2001:db8::/32');

    // Without Router One, BGP Route is offered under Router Three's FRR ID.
    await chooseLocation('Router One');
    submit(container);

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_three'],
      queryType: '__hyperglass_frr_bgp_route__',
      queryTarget: ['2001:db8::/32'],
      queryVariables: {},
    });
  });

  it('drops a variable the same-named query type of the remaining location does not define', async () => {
    // Two custom directives share a name, but not their ID or their variables.
    const lookup = (id: string, variable: string): Directive =>
      ({
        ...device('router_one').directives[0],
        id,
        name: 'Lookup',
        variables: [
          {
            id: variable,
            name: variable.toUpperCase(),
            required: false,
            options: [{ name: `${variable} one`, value: 'one', description: null }],
          },
        ],
      }) as unknown as Directive;
    const config = makeConfig({
      devices: [
        {
          group: 'North America',
          locations: [{ ...device('router_one'), directives: [lookup('lookup_a', 'vrf')] }],
        },
        {
          group: 'Europe',
          locations: [{ ...device('router_three'), directives: [lookup('lookup_b', 'table')] }],
        },
      ],
    } as never);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');
    await chooseLocation('Router Three');
    await chooseQueryType('Lookup');
    await user.type(await targetInput(), '2001:db8::/32');
    await userEvent.click(screen.getAllByRole('combobox').at(-1) as HTMLElement);
    await userEvent.click(within(await openMenu()).getByText('vrf one'));
    expect(useFormState.getState().form.queryVariables).toEqual({ vrf: 'one' });

    // Without Router One, Lookup is offered under Router Three's ID, without `vrf`.
    await chooseLocation('Router One');
    expect(await screen.findByText('TABLE')).toBeInTheDocument();
    expect(screen.queryByText('VRF')).not.toBeInTheDocument();
    submit(container);

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_three'],
      queryType: 'lookup_b',
      queryTarget: ['2001:db8::/32'],
      queryVariables: {},
    });
  });

  it('clears a select target the same-named query type of the remaining location does not offer', async () => {
    const option = (value: string) => ({ name: `Community ${value}`, value, description: null });
    const lookup = (id: string, values: string[]): Directive =>
      ({
        ...device('router_three').directives[0],
        id,
        name: 'Lookup',
        options: values.map(option),
      }) as unknown as Directive;
    const config = makeConfig({
      devices: [
        {
          group: 'North America',
          locations: [
            { ...device('router_one'), directives: [lookup('lookup_a', ['65000:1', '65000:2'])] },
          ],
        },
        {
          group: 'Europe',
          locations: [{ ...device('router_three'), directives: [lookup('lookup_b', ['65000:1'])] }],
        },
      ],
    } as never);
    const { container } = renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');
    await chooseLocation('Router Three');
    await chooseQueryType('Lookup');
    const [, targetSelect] = screen.getAllByRole('combobox');
    await userEvent.click(targetSelect);
    await userEvent.click(within(await openMenu()).getByText('Community 65000:2'));
    expect(useFormState.getState().form.queryTarget).toEqual(['65000:2']);
    expect(screen.getByText('Community 65000:2')).toBeInTheDocument();

    // Router Three's Lookup doesn't offer 65000:2.
    await chooseLocation('Router One');

    expect(useFormState.getState().form.queryType).toBe('lookup_b');
    expect(useFormState.getState().form.queryTarget).toEqual([]);
    expect(screen.queryByText('Community 65000:2')).not.toBeInTheDocument();
    submit(container);
    expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('marks a location without query types in common as an error', async () => {
    const one = device('router_one');
    const three = device('router_three');
    const config = makeConfig({
      devices: [
        {
          group: 'North America',
          locations: [{ ...one, directives: one.directives.slice(0, 1) }],
        },
        { group: 'Europe', locations: [{ ...three, directives: three.directives.slice(0, 1) }] },
      ],
    } as never);
    renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');
    await chooseLocation('Router Three');

    // The message is built in `useFormState.locationChange` from the configured labels.
    expect(
      await screen.findByText(
        `${web.text.queryLocation}s Router One & Router Three have no ${web.text.queryType}s in common.`,
      ),
    ).toBeInTheDocument();
    expect(useFormState.getState().filtered.types).toEqual([]);
  });

  it('restores the previous query when it returns from the results', async () => {
    useFormState.setState({
      form: {
        queryLocation: ['router_one'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTarget: ['192.0.2.1'],
        queryVariables: {},
      },
      filtered: { types: device('router_one').directives, groups: [] },
      target: { display: '192.0.2.1' },
    });
    renderWithProviders(<LookingGlassForm />);

    const inputs = await screen.findAllByDisplayValue('192.0.2.1');
    expect(inputs.map(i => i.getAttribute('name'))).toEqual(['queryTarget', 'queryTargetDisplay']);
    expect(screen.getByRole('button', { name: 'Submit Query' })).toBeInTheDocument();
  });
});

describe('LookingGlassForm submit button', () => {
  it('names the submit button with web.text.submit_query (#581)', () => {
    renderWithProviders(<LookingGlassForm />, {
      config: makeConfig({ web: { text: { submitQuery: 'Envoyer' } } }),
    });

    const button = screen.getByRole('button', { name: 'Envoyer' });
    expect(button).toHaveAttribute('title', 'Envoyer');
    expect(screen.queryByRole('button', { name: 'Submit Query' })).not.toBeInTheDocument();
  });
});

describe('LookingGlassForm validation', () => {
  it('reports every missing field with the configured message on an empty submit', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    submit(container);

    expect(await screen.findByText(noInput(web.text.queryLocation))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('reports an empty target with the configured message', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    await targetInput();

    submit(container);

    expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();
    expect(screen.queryByText(noInput(web.text.queryLocation))).not.toBeInTheDocument();
    expect(screen.queryByText(noInput(web.text.queryType))).not.toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('reports a missing query type with the configured message', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await screen.findByRole('combobox', { name: web.text.queryType });

    submit(container);

    expect(await screen.findByText(noInput(web.text.queryType))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('uses the configured message text, not a built-in one', async () => {
    const config = makeConfig({
      messages: { noInput: 'Bitte {field} angeben' },
      web: { text: { queryLocation: 'Standort' } },
    });
    const { container } = renderWithProviders(<LookingGlassForm />, { config });
    submit(container);

    expect(await screen.findByText('Bitte Standort angeben')).toBeInTheDocument();
  });

  it('reports a missing required directive variable with the configured message', async () => {
    const config = oneDeviceConfig(dev => ({
      ...dev,
      directives: [
        dev.directives[3],
        {
          ...dev.directives[0],
          variables: [
            {
              id: 'vrf',
              name: 'VRF',
              required: true,
              options: [{ name: 'Default', value: 'default', description: null }],
            },
          ],
        } as unknown as Directive,
      ],
    }));
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    await user.type(await targetInput(), '192.0.2.1');

    submit(container);

    expect(await screen.findByText(noInput('VRF'))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');

    // Choosing a value clears the error and lets the query through.
    const variableSelect = screen.getAllByRole('combobox').at(-1);
    await userEvent.click(variableSelect as HTMLElement);
    await userEvent.click(within(await openMenu()).getByText('Default'));
    expect(useFormState.getState().form.queryVariables).toEqual({ vrf: 'default' });
    await waitFor(() => expect(screen.queryByText(noInput('VRF'))).not.toBeInTheDocument());

    submit(container);
    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
  });

  it.each([
    ['typed and then cleared', ''],
    ['only whitespace', '   '],
  ])('reports a target that is %s with the configured message', async (_, typed) => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    const input = await targetInput();
    await user.type(input, typed === '' ? '1' : typed);
    if (typed === '') {
      await user.clear(input);
    }
    expect(useFormState.getState().form.queryTarget).toEqual([typed]);

    submit(container);

    expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('reports an empty value among several targets', async () => {
    useFormState.setState({
      form: {
        queryLocation: ['router_one'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTarget: ['192.0.2.1', ''],
        queryVariables: {},
      },
      filtered: { types: device('router_one').directives, groups: [] },
    });
    const { container } = renderWithProviders(<LookingGlassForm />);
    await targetInput();

    submit(container);

    expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
  });

  it('clears the errors of an empty submit when the form is reset', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    submit(container);
    expect(await screen.findByText(noInput(web.text.queryLocation))).toBeInTheDocument();

    // The header title resets the store while the form stays mounted.
    await act(async () => {
      await useFormState.getState().reset();
    });

    await waitFor(() =>
      expect(screen.queryByText(noInput(web.text.queryLocation))).not.toBeInTheDocument(),
    );
  });

  it('clears the errors of the previous query when every location is removed', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await screen.findByRole('combobox', { name: web.text.queryType });
    submit(container);
    expect(await screen.findByText(noInput(web.text.queryType))).toBeInTheDocument();

    // Removing the only location empties the store, as a reset does.
    await chooseLocation('Router One');
    expect(useFormState.getState().form).toEqual({
      queryLocation: [],
      queryType: '',
      queryTarget: [],
      queryVariables: {},
    });
    await chooseLocation('Router One');

    // The query type field is back, without the error of the previous submit.
    expect(await screen.findByRole('combobox', { name: web.text.queryType })).toBeInTheDocument();
    expect(screen.queryByText(noInput(web.text.queryType))).not.toBeInTheDocument();
  });

  it('does not show the errors from before a reset on the next query', async () => {
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    await targetInput();
    submit(container);
    expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();

    await act(async () => {
      await useFormState.getState().reset();
    });
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    await targetInput();

    expect(screen.queryByText(noInput(web.text.queryTarget))).not.toBeInTheDocument();
  });
});

describe('LookingGlassForm submission', () => {
  async function fillQuery(target: string): Promise<void> {
    const user = userEvent.setup();
    await chooseLocation('Router One');
    await chooseLocation('Router Two');
    await chooseQueryType('BGP Route');
    await user.type(await targetInput(), target);
  }

  it.each([
    ['an IPv4 prefix', '192.0.2.0/24'],
    ['an IPv6 prefix', '2001:db8::/32'],
  ])('switches to the results for %s', async (_, target) => {
    renderWithProviders(<LookingGlassForm />);
    await fillQuery(target);

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTarget: [target],
      queryVariables: {},
    });
    expect(useFormState.getState().loading).toBe(false);
    expect(useFormState.getState().resolvedIsOpen).toBe(false);
  });

  it('resolves a hostname target before switching to the results', async () => {
    // The resolver popover sends DNS queries; leave them pending.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    renderWithProviders(<LookingGlassForm />);
    await fillQuery('example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(useFormState.getState().resolvedIsOpen).toBe(true));
    expect(useFormState.getState().loading).toBe(true);
    expect(useFormState.getState().status).toBe('form');
  });

  it('reloads the page instead of submitting when the greeting is not acknowledged', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as Location);
    renderWithProviders(<LookingGlassForm />);
    await fillQuery('192.0.2.1');
    act(() => useGreeting.setState({ greetingReady: false }));

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(useFormState.getState().status).toBe('form');
    // The form is reset so nothing is submitted after the reload.
    expect(useFormState.getState().form.queryLocation).toEqual([]);
  });
});

describe('LookingGlassForm location cards', () => {
  /** The card of the location with this name. */
  function card(name: string): HTMLElement {
    const found = screen.getByText(name).closest<HTMLElement>('[data-checked]');
    if (found === null) {
      throw new Error(`No card for '${name}'`);
    }
    return found;
  }

  /** Select locations in the store without clicking, as a prefilled link does. */
  function selectInStore(...ids: string[]): void {
    const options = ids.map(id => ({ value: id, label: device(id).name }));
    act(() => {
      useFormState.setState(state => ({
        form: { ...state.form, queryLocation: ids },
        selections: { ...state.selections, queryLocation: options },
      }));
    });
  }

  it('selects a card with one click after the form is reset', async () => {
    renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    expect(card('Router One')).toHaveAttribute('data-checked', 'true');

    // The header title resets the store while the form stays mounted.
    await act(async () => {
      await useFormState.getState().reset();
    });
    expect(card('Router One')).toHaveAttribute('data-checked', 'false');

    await chooseLocation('Router One');

    expect(card('Router One')).toHaveAttribute('data-checked', 'true');
    expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
    expect(useFormState.getState().selections.queryLocation.map(s => s.value)).toEqual([
      'router_one',
    ]);
  });

  it('shows the locations selected in the store without a click', async () => {
    renderWithProviders(<LookingGlassForm />);
    expect(card('Router Three')).toHaveAttribute('data-checked', 'false');

    // Only `form.queryLocation`, which the cards follow.
    act(() => {
      useFormState.setState(state => ({
        form: { ...state.form, queryLocation: ['router_one', 'router_three'] },
      }));
    });

    expect(card('Router One')).toHaveAttribute('data-checked', 'true');
    expect(card('Router Two')).toHaveAttribute('data-checked', 'false');
    expect(card('Router Three')).toHaveAttribute('data-checked', 'true');

    // One click removes a location selected that way, from the card and the store.
    await chooseLocation('Router Three');

    expect(card('Router Three')).toHaveAttribute('data-checked', 'false');
    expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
  });

  it('shows the locations of a prefilled selection and lets a click remove one', async () => {
    renderWithProviders(<LookingGlassForm />);

    selectInStore('router_one', 'router_three');
    expect(card('Router One')).toHaveAttribute('data-checked', 'true');
    expect(card('Router Three')).toHaveAttribute('data-checked', 'true');

    await chooseLocation('Router One');

    expect(card('Router One')).toHaveAttribute('data-checked', 'false');
    expect(useFormState.getState().form.queryLocation).toEqual(['router_three']);
    expect(useFormState.getState().selections.queryLocation.map(s => s.value)).toEqual([
      'router_three',
    ]);
  });

  it('shows the store in the location select too', async () => {
    renderWithProviders(<LookingGlassForm />, {
      config: makeConfig({ web: { locationDisplayMode: 'dropdown' } }),
    });
    const select = screen.getByRole('combobox', { name: web.text.queryLocation });
    const shown = (): HTMLElement => select.closest('form') as HTMLElement;

    selectInStore('router_three');
    expect(within(shown()).getByText('Router Three')).toBeInTheDocument();

    await act(async () => {
      await useFormState.getState().reset();
    });
    expect(within(shown()).queryByText('Router Three')).not.toBeInTheDocument();
  });
});

describe('LookingGlassForm prefill', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    router.isReady = true;
    router.replace.mockClear();
  });

  /**
   * Open the form at this address, as a link does: on a first load the router becomes
   * ready only after the page is mounted.
   */
  function openAddress(address: string, config = testConfig) {
    window.history.replaceState(null, '', address);
    router.isReady = false;
    const result = renderWithProviders(<LookingGlassForm />, { config });
    router.isReady = true;
    result.rerender(<LookingGlassForm />);
    return result;
  }

  /** Open the form at an address with these parameters. */
  function renderPrefilled(params: Record<string, string | string[]>, config = testConfig) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) {
        search.append(key, v);
      }
    }
    return openAddress(`/?${search}`, config);
  }

  /** The value of react-select's form input with this name. */
  function selectValue(name: string): string | undefined {
    return document.querySelector<HTMLInputElement>(`input[name="${name}"]:not([hidden])`)?.value;
  }

  it('shows the values from the link and submits them only when asked', async () => {
    renderPrefilled({
      location: ['router_one', 'router_two'],
      type: 'BGP Route',
      target: '2001:db8::1',
    });

    expect(await targetInput()).toHaveValue('2001:db8::1');
    const select = await screen.findByRole('combobox', { name: web.text.queryType });
    const control = select.closest<HTMLElement>('[class*="-control"]');
    expect(within(control as HTMLElement).getByText('BGP Route')).toBeInTheDocument();
    // Filling the form doesn't submit it.
    expect(useFormState.getState().status).toBe('form');

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_one', 'router_two'],
      queryType: '__hyperglass_juniper_bgp_route__',
      queryTarget: ['2001:db8::1'],
      queryVariables: {},
    });
  });

  it('shows the locations from the link in the location select', async () => {
    const config = makeConfig({ web: { locationDisplayMode: 'dropdown' } });
    renderPrefilled({ location: ['router_three', 'router_one'] }, config);

    const select = await screen.findByRole('combobox', { name: web.text.queryLocation });
    const control = select.closest<HTMLElement>('[class*="-control"]');
    expect(within(control as HTMLElement).getByText('Router Three')).toBeInTheDocument();
    expect(within(control as HTMLElement).getByText('Router One')).toBeInTheDocument();
  });

  it('shows the location from the link as a selected card that a click toggles', async () => {
    const config = makeConfig({ web: { locationDisplayMode: 'gallery' } });
    renderPrefilled({ location: 'router_one', type: 'BGP Route' }, config);
    const card = (name: string) => screen.getByText(name).closest('[data-checked]');

    await waitFor(() =>
      expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_bgp_route__'),
    );
    expect(card('Router One')).toHaveAttribute('data-checked', 'true');
    expect(card('Router Two')).toHaveAttribute('data-checked', 'false');
    expect(card('Router Three')).toHaveAttribute('data-checked', 'false');

    // One click removes the prefilled location, from the store and the card.
    await chooseLocation('Router One');
    expect(card('Router One')).toHaveAttribute('data-checked', 'false');
    expect(useFormState.getState().form.queryLocation).toEqual([]);
    expect(useFormState.getState().selections.queryLocation).toEqual([]);

    // A second click selects it again.
    await chooseLocation('Router One');
    expect(card('Router One')).toHaveAttribute('data-checked', 'true');
    expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
    expect(useFormState.getState().selections.queryLocation.map(s => s.value)).toEqual([
      'router_one',
    ]);
    expect(card('Router Two')).toHaveAttribute('data-checked', 'false');
  });

  it('submits the query type of a mixed-vendor link under the first location', async () => {
    renderPrefilled({
      location: ['router_three', 'router_one'],
      type: '__hyperglass_juniper_bgp_route__',
      target: '2001:db8::/32',
    });
    await targetInput();

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(useFormState.getState().form.queryType).toBe('__hyperglass_frr_bgp_route__');
  });

  it('shows a select target from the link as chosen', async () => {
    renderPrefilled({
      location: 'router_three',
      type: 'peer_communities',
      target: '65000:2',
    });

    await waitFor(() => expect(selectValue('queryTarget')).toBe('65000:2'));
  });

  it('shows and submits the variables from the link', async () => {
    const config = oneDeviceConfig(dev => ({
      ...dev,
      directives: [
        dev.directives[3],
        {
          ...dev.directives[0],
          variables: [
            {
              id: 'vrf',
              name: 'VRF',
              required: true,
              options: [
                { name: 'Default', value: 'default', description: null },
                { name: 'Customer', value: 'customer', description: null },
              ],
            },
          ],
        } as unknown as Directive,
      ],
    }));
    renderPrefilled(
      {
        location: 'router_one',
        type: 'BGP Route',
        target: '192.0.2.0/24',
        'var.vrf': 'customer',
      },
      config,
    );

    await waitFor(() => expect(selectValue('queryVariables.vrf')).toBe('customer'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
    expect(useFormState.getState().form.queryVariables).toEqual({ vrf: 'customer' });
  });

  it('submits a query type without a field from the link', async () => {
    const config = oneDeviceConfig(dev => ({
      ...dev,
      directives: [
        dev.directives[3],
        { ...dev.directives[0], fieldType: null } as unknown as Directive,
      ],
    }));
    const { container } = renderPrefilled(
      { location: 'router_one', type: 'BGP Route', target: '192.0.2.1' },
      config,
    );
    await waitFor(() => expect(useFormState.getState().form.queryTarget).toEqual(['null']));

    submit(container);

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
  });

  it('leaves out the values the configuration does not offer, without a message', async () => {
    renderPrefilled({
      location: ['no_such_device', 'router_one'],
      type: 'no_such_type',
      target: '192.0.2.1',
      'var.vrf': 'default',
    });

    expect(await screen.findByRole('combobox', { name: web.text.queryType })).toBeInTheDocument();
    expect(useFormState.getState().form).toEqual({
      queryLocation: ['router_one'],
      queryType: '',
      queryTarget: [],
      queryVariables: {},
    });
    expect(screen.queryByPlaceholderText(/.+/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(noInput(web.text.queryType))).not.toBeInTheDocument();
  });

  it('resolves a hostname target from the link before switching to the results', async () => {
    // The resolver popover sends DNS queries; leave them pending.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    renderPrefilled({
      location: 'router_one',
      type: 'Ping',
      target: 'example.com',
    });
    await targetInput();

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(useFormState.getState().resolvedIsOpen).toBe(true));
    expect(useFormState.getState().status).toBe('form');
  });

  it('still requires the greeting to be acknowledged', async () => {
    act(() => useGreeting.setState({ greetingReady: false }));
    renderPrefilled({ location: 'router_one', type: 'Ping', target: '192.0.2.1' });
    await targetInput();
    expect(useFormState.getState().status).toBe('form');
    // Stub the reload only now: the form reads its parameters from the real address.
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as Location);

    await userEvent.click(screen.getByRole('button', { name: 'Submit Query' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(useFormState.getState().status).toBe('form');
  });

  it('waits for the router to be ready', async () => {
    window.history.replaceState(null, '', '/?location=router_one&type=Ping&target=192.0.2.1');
    router.isReady = false;
    const { rerender } = renderWithProviders(<LookingGlassForm />);
    await screen.findByText('Router One');
    expect(useFormState.getState().form.queryLocation).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();

    router.isReady = true;
    rerender(<LookingGlassForm />);

    expect(await targetInput()).toHaveValue('192.0.2.1');
  });

  it('removes its parameters from the address through the router and keeps the others', async () => {
    openAddress(
      '/?utm_source=ticket&location=router_one&type=Ping&target=2001:db8::1&var.vrf=default&q=a%20b&flag#top',
    );
    await targetInput();

    expect(router.replace).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith(
      '/?utm_source=ticket&q=a%20b&flag',
      '/?utm_source=ticket&q=a%20b&flag#top',
      { shallow: true, scroll: false },
    );
    expect(window.location.search).toBe('?utm_source=ticket&q=a%20b&flag');
    expect(window.location.hash).toBe('#top');
  });

  it('keeps the address of a page served as index.html, on the index route', async () => {
    openAddress('/index.html?location=router_one&type=Ping&target=192.0.2.1');
    await targetInput();

    // The route is the index page's; `/index.html` stays the address.
    expect(router.replace).toHaveBeenCalledWith('/', '/index.html', {
      shallow: true,
      scroll: false,
    });
    expect(window.location.pathname).toBe('/index.html');
    expect(window.location.search).toBe('');
  });

  it('applies a link when the router is ready as the form mounts', async () => {
    // As after a client-side navigation. The error `locationChange` reports must survive
    // the mount, when react-hook-form is reset to the empty form.
    const one = device('router_one');
    const three = device('router_three');
    const config = makeConfig({
      devices: [
        { group: 'North America', locations: [{ ...one, directives: one.directives.slice(0, 1) }] },
        { group: 'Europe', locations: [{ ...three, directives: three.directives.slice(0, 1) }] },
      ],
    } as never);
    window.history.replaceState(null, '', '/?location=router_one&location=router_three');
    renderWithProviders(<LookingGlassForm />, { config });

    expect(
      await screen.findByText(
        `${web.text.queryLocation}s Router One & Router Three have no ${web.text.queryType}s in common.`,
      ),
    ).toBeInTheDocument();
    expect(useFormState.getState().form.queryLocation).toEqual(['router_one', 'router_three']);
    expect(window.location.search).toBe('');
  });

  it('reports locations from a link without query types in common', async () => {
    const one = device('router_one');
    const three = device('router_three');
    const config = makeConfig({
      devices: [
        { group: 'North America', locations: [{ ...one, directives: one.directives.slice(0, 1) }] },
        { group: 'Europe', locations: [{ ...three, directives: three.directives.slice(0, 1) }] },
      ],
    } as never);
    renderPrefilled({ location: ['router_one', 'router_three'] }, config);

    expect(
      await screen.findByText(
        `${web.text.queryLocation}s Router One & Router Three have no ${web.text.queryType}s in common.`,
      ),
    ).toBeInTheDocument();
  });

  describe('with a query of the same type already in the form', () => {
    // A query is in the store, as when the page is reached again by a client-side
    // navigation. BGP Route takes a required VRF.
    const config = oneDeviceConfig(dev => ({
      ...dev,
      directives: [
        dev.directives[3],
        {
          ...dev.directives[0],
          variables: [
            {
              id: 'vrf',
              name: 'VRF',
              required: true,
              options: [
                { name: 'Default', value: 'default', description: null },
                { name: 'Customer', value: 'customer', description: null },
              ],
            },
          ],
        } as unknown as Directive,
      ],
    }));

    beforeEach(() => {
      const [types] = config.devices.map(g => g.locations[0].directives);
      useFormState.setState({
        form: {
          queryLocation: ['router_one'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['192.0.2.1'],
          queryVariables: { vrf: 'customer' },
        },
        filtered: { types, groups: [] },
        selections: {
          queryLocation: [{ value: 'router_one', label: 'Router One' }],
          queryType: { value: '__hyperglass_juniper_bgp_route__', label: 'BGP Route' },
        },
        target: { display: '192.0.2.1' },
      });
    });

    it('shows no target when the link has none that applies, and does not submit the old one', async () => {
      const { container } = renderPrefilled(
        {
          location: 'router_one',
          type: 'BGP Route',
          target: '192.0.2.9\nshow running-config',
          'var.vrf': 'default',
        },
        config,
      );

      await waitFor(() => expect(useFormState.getState().form.queryTarget).toEqual([]));
      expect(await targetInput()).toHaveValue('');
      expect(container.querySelector('input[name="queryTarget"]')).toHaveValue('');
      expect(selectValue('queryVariables.vrf')).toBe('default');

      submit(container);

      expect(await screen.findByText(noInput(web.text.queryTarget))).toBeInTheDocument();
      expect(useFormState.getState().status).toBe('form');
    });

    it('shows no variable when the link has none, and does not submit the old one', async () => {
      const { container } = renderPrefilled(
        { location: 'router_one', type: 'BGP Route', target: '2001:db8::/32' },
        config,
      );

      expect(await targetInput()).toHaveValue('2001:db8::/32');
      await waitFor(() => expect(selectValue('queryVariables.vrf')).toBe(''));

      submit(container);

      expect(await screen.findByText(noInput('VRF'))).toBeInTheDocument();
      expect(useFormState.getState().status).toBe('form');
    });
  });

  it('leaves an address without its parameters as it is', async () => {
    openAddress('/?q=a%20b');
    await screen.findByText('Router One');

    expect(router.replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?q=a%20b');
  });

  it.each([
    ['a valid share id', '0123456789abcdef0123456789abcdef'],
    ['an invalid share id', 'not-a-share'],
    ['an empty share parameter', ''],
  ])('ignores every prefill parameter alongside %s', async (_, share) => {
    // A share link shows a snapshot: a form someone else filled in must not come with it
    // (#560). The shared result page removes these parameters from the address.
    renderPrefilled({
      share,
      location: ['router_one', 'router_two'],
      type: 'BGP Route',
      target: '2001:db8::1',
      'var.vrf': 'default',
    });

    expect((await screen.findAllByText('Router One')).length).toBeGreaterThan(0);
    // Long enough for the prefill effect to have run.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(useFormState.getState().form).toEqual({
      queryLocation: [],
      queryType: '',
      queryTarget: [],
      queryVariables: {},
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not apply the link again when the form returns', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPrefilled({
      location: 'router_one',
      type: 'BGP Route',
      target: '192.0.2.1',
    });
    await user.clear(await targetInput());
    await user.type(await targetInput(), '2001:db8::/32');

    // The form unmounts while the results show, and mounts again on its return.
    unmount();
    renderWithProviders(<LookingGlassForm />);

    expect(await targetInput()).toHaveValue('2001:db8::/32');
    expect(useFormState.getState().form.queryTarget).toEqual(['2001:db8::/32']);
  });
});
