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

  it('chooses the query type when the selected location has only one', async () => {
    const config = oneDeviceConfig(dev => ({ ...dev, directives: dev.directives.slice(3, 4) }));
    renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');

    expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_ping__');
    expect(await targetInput()).toBeInTheDocument();
  });

  it('does not pass an automatically chosen query type to the form validation', async () => {
    // Current behaviour, likely a bug: `locationChange` sets the query type in the store
    // but not in react-hook-form, and the select shows no selection. Submitting reports a
    // missing query type until the user picks the only option by hand.
    const config = oneDeviceConfig(dev => ({ ...dev, directives: dev.directives.slice(3, 4) }));
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />, { config });
    await chooseLocation('Router One');
    await user.type(await targetInput(), '192.0.2.1');

    submit(container);

    expect(await screen.findByText(noInput(web.text.queryType))).toBeInTheDocument();
    expect(useFormState.getState().status).toBe('form');
    expect(useFormState.getState().selections.queryType).toBeNull();
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

  it('accepts a target that was typed and then cleared', async () => {
    // Current behaviour: clearing the input leaves `['']` as the target, which passes the
    // "not empty" check, so the form switches to results with an empty target.
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LookingGlassForm />);
    await chooseLocation('Router One');
    await chooseQueryType('BGP Route');
    const input = await targetInput();
    await user.type(input, '1');
    await user.clear(input);
    expect(useFormState.getState().form.queryTarget).toEqual(['']);

    submit(container);

    await waitFor(() => expect(useFormState.getState().status).toBe('results'));
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
