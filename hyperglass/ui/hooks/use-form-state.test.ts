import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { testConfig } from '~/__tests__/render';
import { queryClient } from '~/context';
import {
  parsePrefill,
  withoutPrefill,
  useFormInteractive,
  useFormSelections,
  useFormState,
  useView,
} from './use-form-state';

import type { Device, Directive } from '~/types';
import type { FormPrefill } from './use-form-state';

test('back - returns to the form and keeps the last query', () => {
  const form = {
    queryLocation: ['lab-frr'],
    queryTarget: ['1.1.1.1'],
    queryType: 'bgp_route',
    queryVariables: { group: 'party_x' },
  };
  useFormState.setState({ form, status: 'results', target: { display: '1.1.1.1' } });

  useFormState.getState().back();

  const state = useFormState.getState();
  expect(state.status).toBe('form');
  expect(state.form).toEqual(form);
  expect(state.target.display).toBe('1.1.1.1');
});

test('reset - clears the last query', async () => {
  await useFormState.getState().reset();

  expect(useFormState.getState().form.queryLocation).toEqual([]);
  expect(useFormState.getState().form.queryVariables).toEqual({});
});

// The cases below start from an empty store. `back` and `reset` also clear the app's
// shared query cache (`queryClient` from `~/context`), so that cache is cleared too.

const devices = testConfig.devices.flatMap(group => group.locations);
const getDevice = (id: string): Device | null => devices.find(d => d.id === id) ?? null;

function device(id: string): Device {
  const found = getDevice(id);
  if (found === null) {
    throw new Error(`No device '${id}' in the fixture`);
  }
  return found;
}

/** Call `locationChange` the way the form does, with spies for the form callbacks. */
function changeLocations(locations: string[], devicesById = getDevice) {
  const setError = vi.fn();
  const clearErrors = vi.fn();
  useFormState.getState().locationChange(locations, {
    setError,
    clearErrors,
    getDevice: devicesById,
    text: testConfig.web.text,
  });
  return { setError, clearErrors };
}

const query = {
  queryLocation: ['router_one', 'router_two'],
  queryTarget: ['2001:db8::/32'],
  queryType: '__hyperglass_juniper_bgp_route__',
  queryVariables: {},
};

function seedCache(): void {
  for (const queryLocation of query.queryLocation) {
    queryClient.setQueryData(['/api/query', { ...query, queryLocation }], { output: 'cached' });
  }
  queryClient.setQueryData(['/api/devices'], []);
}

function cachedQueryKeys(): unknown[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .map(q => q.queryKey);
}

describe('useFormState', () => {
  beforeEach(async () => {
    queryClient.clear();
    await useFormState.getState().reset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('starts empty', () => {
    const state = useFormState.getState();
    expect(state.form).toEqual({
      queryLocation: [],
      queryTarget: [],
      queryType: '',
      queryVariables: {},
    });
    expect(state.filtered).toEqual({ types: [], groups: [] });
    expect(state.selections).toEqual({ queryLocation: [], queryType: null });
    expect(state.status).toBe('form');
    expect(state.loading).toBe(false);
    expect(state.resolvedIsOpen).toBe(false);
    expect(state.getDirective()).toBeNull();
  });

  it('sets single values without touching the others', () => {
    const state = useFormState.getState();
    state.setFormValue('queryTarget', ['192.0.2.1']);
    state.setLoading(true);
    state.setStatus('results');
    state.setTarget({ display: '192.0.2.1' });
    state.setSelection('queryType', { value: 'ping', label: 'Ping' });
    state.resolvedOpen();

    const next = useFormState.getState();
    expect(next.form.queryTarget).toEqual(['192.0.2.1']);
    expect(next.form.queryType).toBe('');
    expect(next.loading).toBe(true);
    expect(next.status).toBe('results');
    expect(next.target).toEqual({ display: '192.0.2.1' });
    expect(next.selections).toEqual({
      queryLocation: [],
      queryType: { value: 'ping', label: 'Ping' },
    });
    expect(next.resolvedIsOpen).toBe(true);

    next.resolvedClose();
    expect(useFormState.getState().resolvedIsOpen).toBe(false);
  });

  it('stores responses by device ID', () => {
    const response = { output: 'ok' } as unknown as QueryResponse;
    expect(useFormState.getState().response('router_one')).toBeNull();

    useFormState.getState().addResponse('router_one', response);

    expect(useFormState.getState().response('router_one')).toBe(response);
    expect(useFormState.getState().response('router_two')).toBeNull();
  });

  it('returns the filtered directive that matches the query type', () => {
    const directives = device('router_one').directives;
    useFormState.setState({ filtered: { types: directives, groups: [] } });

    useFormState.getState().setFormValue('queryType', directives[2].id);
    expect(useFormState.getState().getDirective()).toBe(directives[2]);

    useFormState.getState().setFormValue('queryType', 'no_such_directive');
    expect(useFormState.getState().getDirective()).toBeNull();
  });

  describe('locationChange', () => {
    it('offers the directives of a single location', () => {
      const { clearErrors, setError } = changeLocations(['router_three']);

      const { form, filtered } = useFormState.getState();
      expect(form.queryLocation).toEqual(['router_three']);
      expect(filtered.types.map(t => t.id)).toEqual(
        device('router_three').directives.map(d => d.id),
      );
      expect(filtered.groups).toEqual([]);
      expect(form.queryType).toBe('');
      expect(clearErrors).toHaveBeenCalledWith('queryLocation');
      expect(setError).not.toHaveBeenCalled();
    });

    it('intersects directives across platforms by name', () => {
      changeLocations(['router_two', 'router_three']);

      // Arista's IDs, as the first location's, for the names FRR also has.
      expect(useFormState.getState().filtered.types.map(t => t.id)).toEqual(
        device('router_two').directives.map(d => d.id),
      );
    });

    it('intersects directive groups', () => {
      const withGroups = (dev: Device, groups: string[][]): Device => ({
        ...dev,
        directives: dev.directives.map((d, i) => ({ ...d, groups: groups[i] ?? [] })),
      });
      const one = withGroups(device('router_one'), [['IPv4', 'IPv6'], ['IPv4']]);
      const two = withGroups(device('router_two'), [['IPv6']]);
      const byId = (id: string): Device | null =>
        id === 'router_one' ? one : id === 'router_two' ? two : null;

      changeLocations(['router_one', 'router_two'], byId);

      expect(useFormState.getState().filtered.groups).toEqual(['IPv6']);
    });

    it('chooses the query type when only one directive is in common', () => {
      const one = { ...device('router_one'), directives: device('router_one').directives.slice(4) };
      useFormState.getState().setFormValue('queryVariables', { stale: 'value' });

      changeLocations(['router_one'], id => (id === 'router_one' ? one : null));

      expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_traceroute__');
      expect(useFormState.getState().form.queryVariables).toEqual({});
      // The select shows the chosen query type.
      expect(useFormState.getState().selections.queryType).toEqual({
        value: '__hyperglass_juniper_traceroute__',
        label: 'Traceroute',
      });
    });

    it('clears the target when it chooses a different query type', () => {
      const one = { ...device('router_one'), directives: device('router_one').directives.slice(4) };
      useFormState.setState({
        form: {
          queryLocation: ['router_one'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['2001:db8::/32'],
          queryVariables: {},
        },
        filtered: { types: device('router_one').directives, groups: [] },
        target: { display: '2001:db8::/32' },
      });

      changeLocations(['router_one'], id => (id === 'router_one' ? one : null));

      const { form, target } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_juniper_traceroute__');
      expect(form.queryTarget).toEqual([]);
      expect(target.display).toBe('');
    });

    it('keeps the target when the only query type in common is the current one', () => {
      const ping = (id: string): Device | null => {
        const dev = getDevice(id);
        return dev && { ...dev, directives: dev.directives.filter(d => d.name === 'Ping') };
      };
      const selection = { value: '__hyperglass_juniper_ping__', label: 'Ping' };
      useFormState.setState({
        form: {
          queryLocation: ['router_one'],
          queryType: '__hyperglass_juniper_ping__',
          queryTarget: ['2001:db8::1'],
          queryVariables: {},
        },
        filtered: { types: ping('router_one')?.directives ?? [], groups: [] },
        selections: { queryLocation: [], queryType: selection },
        target: { display: '2001:db8::1' },
      });

      changeLocations(['router_one', 'router_two'], ping);

      const { form, selections, target } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_juniper_ping__');
      expect(form.queryTarget).toEqual(['2001:db8::1']);
      expect(target.display).toBe('2001:db8::1');
      expect(selections.queryType).toEqual(selection);
    });

    it('clears a query type the new locations do not offer, with its target and variables', () => {
      useFormState.setState({
        form: {
          queryLocation: ['router_three'],
          queryType: 'peer_communities',
          queryTarget: ['65000:1'],
          queryVariables: { stale: 'value' },
        },
        filtered: { types: device('router_three').directives, groups: [] },
        selections: {
          queryLocation: [],
          queryType: { value: 'peer_communities', label: 'Peer Communities' },
        },
        target: { display: '65000:1' },
      });

      changeLocations(['router_three', 'router_one']);

      const { form, selections, target } = useFormState.getState();
      expect(form.queryType).toBe('');
      expect(form.queryTarget).toEqual([]);
      expect(form.queryVariables).toEqual({});
      expect(target.display).toBe('');
      expect(selections.queryType).toBeNull();
    });

    it('clears the query type when every location is removed', () => {
      changeLocations(['router_one']);
      useFormState.setState(state => ({
        form: {
          ...state.form,
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['192.0.2.0/24'],
        },
        selections: {
          ...state.selections,
          queryType: { value: '__hyperglass_juniper_bgp_route__', label: 'BGP Route' },
        },
      }));

      changeLocations([]);

      const { form, selections } = useFormState.getState();
      expect(form.queryType).toBe('');
      expect(form.queryTarget).toEqual([]);
      expect(selections.queryType).toBeNull();
    });

    it('keeps a query type the new locations still offer, with its target and variables', () => {
      const selection = { value: '__hyperglass_juniper_bgp_route__', label: 'BGP Route' };
      const form = {
        queryLocation: ['router_one'],
        queryType: '__hyperglass_juniper_bgp_route__',
        queryTarget: ['2001:db8::/32'],
        queryVariables: { kept: 'value' },
      };
      useFormState.setState({
        form,
        filtered: { types: device('router_one').directives, groups: [] },
        selections: { queryLocation: [], queryType: selection },
        target: { display: '2001:db8::/32' },
      });

      changeLocations(['router_one', 'router_two']);

      const state = useFormState.getState();
      expect(state.form).toEqual({ ...form, queryLocation: ['router_one', 'router_two'] });
      expect(state.target.display).toBe('2001:db8::/32');
      expect(state.selections.queryType).toEqual(selection);
    });

    it('moves the query type to the same-named directive of the remaining location', () => {
      // With Router One and Router Three selected, the offered directives carry Router
      // One's Juniper IDs. With Router One removed, BGP Route is still offered, under
      // Router Three's FRR ID.
      useFormState.setState({
        form: {
          queryLocation: ['router_one', 'router_three'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['2001:db8::/32'],
          queryVariables: {},
        },
        filtered: { types: device('router_one').directives, groups: [] },
        selections: {
          queryLocation: [],
          queryType: { value: '__hyperglass_juniper_bgp_route__', label: 'BGP Route' },
        },
        target: { display: '2001:db8::/32' },
      });

      changeLocations(['router_three']);

      const { form, selections, target } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_frr_bgp_route__');
      expect(selections.queryType).toEqual({
        value: '__hyperglass_frr_bgp_route__',
        label: 'BGP Route',
      });
      expect(form.queryTarget).toEqual(['2001:db8::/32']);
      expect(target.display).toBe('2001:db8::/32');
    });

    describe('when the query type moves to a same-named directive with another ID', () => {
      // Two custom directives may share a name and differ in everything else: their
      // variables, their target options, even their field type.
      const option = (value: string) => ({ name: value, value, description: null });
      const variable = (id: string, values: string[]) => ({
        id,
        name: id,
        required: false,
        options: values.map(option),
      });
      const lookup = (id: string, extra: Record<string, unknown>): Directive =>
        ({
          ...device('router_one').directives[0],
          id,
          name: 'Lookup',
          variables: [],
          ...extra,
        }) as Directive;

      /**
       * Select Router One (offering `first`) and Router Three (offering `second`) with
       * `first`'s query type and these values, then remove Router One.
       */
      function removeFirst(
        first: Directive,
        second: Directive,
        values: { queryTarget: string[]; queryVariables: Record<string, string> },
      ) {
        const one = { ...device('router_one'), directives: [first] };
        const three = { ...device('router_three'), directives: [second] };
        const byId = (id: string): Device | null =>
          id === 'router_one' ? one : id === 'router_three' ? three : null;
        useFormState.setState({
          form: { queryLocation: ['router_one', 'router_three'], queryType: first.id, ...values },
          filtered: { types: [first], groups: [] },
          selections: { queryLocation: [], queryType: { value: first.id, label: 'Lookup' } },
          target: { display: values.queryTarget[0] ?? '' },
        });

        changeLocations(['router_three'], byId);

        const { form, target } = useFormState.getState();
        expect(form.queryType).toBe(second.id);
        return { form, target };
      }

      it('keeps only the variables and values the new directive offers', () => {
        const first = lookup('lookup_a', {
          variables: [
            variable('vrf', ['blue', 'red']),
            variable('afi', ['ipv4', 'ipv6']),
            variable('table', ['inet.0']),
          ],
        });
        const second = lookup('lookup_b', {
          variables: [variable('vrf', ['blue']), variable('afi', ['ipv4', 'ipv6'])],
        });

        const { form } = removeFirst(first, second, {
          queryTarget: ['2001:db8::/32'],
          queryVariables: { vrf: 'red', afi: 'ipv6', table: 'inet.0' },
        });

        // `table` isn't defined and `red` isn't offered by the new directive.
        expect(form.queryVariables).toEqual({ afi: 'ipv6' });
        expect(form.queryTarget).toEqual(['2001:db8::/32']);
      });

      it.each([
        ['keeps', '65000:1', ['65000:1']],
        ['clears', '65000:2', []],
      ])('%s a select target by whether the new options offer it (%s)', (_, value, expected) => {
        const first = lookup('lookup_a', {
          fieldType: 'select',
          options: [option('65000:1'), option('65000:2')],
        });
        const second = lookup('lookup_b', { fieldType: 'select', options: [option('65000:1')] });

        const { form, target } = removeFirst(first, second, {
          queryTarget: [value],
          queryVariables: {},
        });

        expect(form.queryTarget).toEqual(expected);
        expect(target.display).toBe(expected[0] ?? '');
      });

      it('clears the target when the new directive has another field type', () => {
        const first = lookup('lookup_a', { fieldType: 'select', options: [option('65000:1')] });
        const second = lookup('lookup_b', {});

        const { form, target } = removeFirst(first, second, {
          queryTarget: ['65000:1'],
          queryVariables: {},
        });

        expect(form.queryTarget).toEqual([]);
        expect(target.display).toBe('');
      });
    });

    it('reports locations without directives in common', () => {
      const one = {
        ...device('router_one'),
        directives: device('router_one').directives.slice(0, 1),
      };
      const three = {
        ...device('router_three'),
        directives: device('router_three').directives.slice(0, 1),
      };
      const byId = (id: string): Device | null =>
        id === 'router_one' ? one : id === 'router_three' ? three : null;
      useFormState.getState().setSelection('queryLocation', [
        { value: 'router_one', label: 'Router One' },
        { value: 'router_three', label: 'Router Three' },
      ]);

      const { setError } = changeLocations(['router_one', 'router_three'], byId);

      expect(useFormState.getState().filtered.types).toEqual([]);
      expect(setError).toHaveBeenCalledWith('queryLocation', {
        message: 'Locations Router One & Router Three have no Query Types in common.',
      });
    });

    it('ignores location IDs with no device', () => {
      const { setError } = changeLocations(['no_such_device']);

      expect(useFormState.getState().form.queryLocation).toEqual(['no_such_device']);
      expect(useFormState.getState().filtered.types).toEqual([]);
      expect(setError).not.toHaveBeenCalled();
    });

    it('clears the choices when every location is removed', () => {
      changeLocations(['router_one']);
      changeLocations([]);

      expect(useFormState.getState().form.queryLocation).toEqual([]);
      expect(useFormState.getState().filtered.types).toEqual([]);
    });
  });

  describe('prefillForm', () => {
    /** Call `prefillForm` the way the form does, with spies for the form callbacks. */
    function prefill(values: Partial<FormPrefill>, devicesById = getDevice) {
      const setError = vi.fn();
      const clearErrors = vi.fn();
      useFormState
        .getState()
        .prefillForm(
          { queryLocation: [], queryType: null, queryTarget: null, queryVariables: {}, ...values },
          { setError, clearErrors, getDevice: devicesById, text: testConfig.web.text },
        );
      return { setError, clearErrors };
    }

    /** Router One with only the given directives. */
    function routerOneWith(directives: Directive[]): (id: string) => Device | null {
      const one = { ...device('router_one'), directives };
      return id => (id === 'router_one' ? one : getDevice(id));
    }

    const vrf = {
      id: 'vrf',
      name: 'VRF',
      required: false,
      options: [
        { name: 'Default', value: 'default', description: null },
        { name: 'Customer', value: 'customer', description: null },
      ],
    };
    // A variable may be called `location`, like the location parameter.
    const location = { ...vrf, id: 'location', name: 'Location' };

    it('selects a location and offers its query types', () => {
      prefill({ queryLocation: ['router_three'] });

      const { form, selections, filtered } = useFormState.getState();
      expect(form.queryLocation).toEqual(['router_three']);
      expect(selections.queryLocation).toEqual([{ value: 'router_three', label: 'Router Three' }]);
      expect(filtered.types).toEqual(device('router_three').directives);
      expect(form.queryType).toBe('');
    });

    it('selects several locations in order and offers their query types in common', () => {
      prefill({ queryLocation: ['router_two', 'router_one'] });

      const { form, selections, filtered } = useFormState.getState();
      expect(form.queryLocation).toEqual(['router_two', 'router_one']);
      expect(selections.queryLocation.map(s => s.value)).toEqual(['router_two', 'router_one']);
      expect(filtered.types.map(t => t.id)).toEqual(device('router_two').directives.map(d => d.id));
    });

    it('leaves out unknown locations', () => {
      prefill({ queryLocation: ['no_such_device', 'router_one'] });

      expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
      expect(useFormState.getState().selections.queryLocation.map(s => s.value)).toEqual([
        'router_one',
      ]);
    });

    it('changes nothing without a known location', () => {
      const before = useFormState.getState();
      prefill({
        queryLocation: ['no_such_device'],
        queryType: 'Ping',
        queryTarget: '192.0.2.1',
      });

      const after = useFormState.getState();
      expect(after.form).toEqual(before.form);
      expect(after.selections).toEqual(before.selections);
      expect(after.filtered).toEqual(before.filtered);
    });

    it('reports locations without query types in common, as a selection does', () => {
      const one = {
        ...device('router_one'),
        directives: device('router_one').directives.slice(0, 1),
      };
      const three = {
        ...device('router_three'),
        directives: device('router_three').directives.slice(0, 1),
      };
      const byId = (id: string): Device | null =>
        id === 'router_one' ? one : id === 'router_three' ? three : null;

      const { setError } = prefill(
        { queryLocation: ['router_one', 'router_three'], queryType: 'BGP Route' },
        byId,
      );

      expect(setError).toHaveBeenCalledWith('queryLocation', {
        message: 'Locations Router One & Router Three have no Query Types in common.',
      });
      expect(useFormState.getState().form.queryType).toBe('');
    });

    it('selects the query type by ID', () => {
      prefill({ queryLocation: ['router_one'], queryType: '__hyperglass_juniper_ping__' });

      const { form, selections } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_juniper_ping__');
      expect(selections.queryType).toEqual({ value: '__hyperglass_juniper_ping__', label: 'Ping' });
    });

    it('selects the query type by name', () => {
      prefill({ queryLocation: ['router_three'], queryType: 'BGP Route' });

      const { form, selections } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_frr_bgp_route__');
      expect(selections.queryType).toEqual({
        value: '__hyperglass_frr_bgp_route__',
        label: 'BGP Route',
      });
    });

    it('selects the query type by the ID of another selected location', () => {
      // The offered directives carry the first location's (FRR) IDs. The link has Router
      // One's Juniper ID, as when it was made with Router One first.
      prefill({
        queryLocation: ['router_three', 'router_one'],
        queryType: '__hyperglass_juniper_bgp_route__',
      });

      expect(useFormState.getState().form.queryType).toBe('__hyperglass_frr_bgp_route__');
    });

    it('leaves out a query type the locations do not offer, with its target', () => {
      // Router One has no Peer Communities, and Router Three's directive ID is no use.
      prefill({
        queryLocation: ['router_one'],
        queryType: 'peer_communities',
        queryTarget: '65000:1',
      });

      const { form, selections, target } = useFormState.getState();
      expect(form.queryType).toBe('');
      expect(selections.queryType).toBeNull();
      expect(form.queryTarget).toEqual([]);
      expect(target.display).toBe('');
    });

    it('leaves out a target without a query type', () => {
      prefill({ queryLocation: ['router_one'], queryTarget: '192.0.2.1' });

      expect(useFormState.getState().form.queryTarget).toEqual([]);
      expect(useFormState.getState().target.display).toBe('');
    });

    it.each([
      ['an IPv4 address', '192.0.2.1'],
      ['an IPv6 address', '2001:db8::1'],
      ['an IPv6 prefix', '2001:db8::/32'],
      ['an IPv6 address with a zone', 'fe80::1%eth0'],
      ['a hostname', 'example.com'],
    ])('sets the target and its display to %s', (_, value) => {
      prefill({ queryLocation: ['router_one'], queryType: 'BGP Route', queryTarget: value });

      expect(useFormState.getState().form.queryTarget).toEqual([value]);
      expect(useFormState.getState().target.display).toBe(value);
    });

    it('sets a target for the only query type, chosen for the locations', () => {
      // `locationChange` chooses the only query type and clears the target, so the
      // target from the link is set after it.
      const byId = routerOneWith(device('router_one').directives.slice(3, 4));
      prefill({ queryLocation: ['router_one'], queryTarget: '2001:db8::1' }, byId);

      const { form, selections } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_juniper_ping__');
      expect(selections.queryType).toEqual({ value: '__hyperglass_juniper_ping__', label: 'Ping' });
      expect(form.queryTarget).toEqual(['2001:db8::1']);
    });

    it('sets a select target that is one of the options', () => {
      prefill({
        queryLocation: ['router_three'],
        queryType: 'Peer Communities',
        queryTarget: '65000:2',
      });

      expect(useFormState.getState().form.queryTarget).toEqual(['65000:2']);
      expect(useFormState.getState().target.display).toBe('65000:2');
    });

    it('leaves out a select target that is not one of the options', () => {
      prefill({
        queryLocation: ['router_three'],
        queryType: 'Peer Communities',
        queryTarget: '65000:3',
      });

      expect(useFormState.getState().form.queryType).toBe('peer_communities');
      expect(useFormState.getState().form.queryTarget).toEqual([]);
      expect(useFormState.getState().target.display).toBe('');
    });

    it('leaves out the target of a query type without a field', () => {
      const ping = device('router_one').directives[3];
      const byId = routerOneWith([{ ...ping, fieldType: null } as unknown as Directive]);
      prefill({ queryLocation: ['router_one'], queryTarget: '192.0.2.1' }, byId);

      // The form fills in `['null']` for such a query type.
      expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_ping__');
      expect(useFormState.getState().form.queryTarget).toEqual([]);
    });

    it('sets the variables of the query type with an allowed value, and only those', () => {
      const route = device('router_one').directives[0];
      const byId = routerOneWith([{ ...route, variables: [vrf, location] } as Directive]);
      prefill(
        {
          queryLocation: ['router_one'],
          queryType: 'BGP Route',
          queryTarget: '2001:db8::/32',
          queryVariables: { vrf: 'customer', location: 'not_an_option', other: 'default' },
        },
        byId,
      );

      expect(useFormState.getState().form.queryVariables).toEqual({ vrf: 'customer' });
    });

    it('sets a variable named like a parameter', () => {
      const route = device('router_one').directives[0];
      const byId = routerOneWith([{ ...route, variables: [location] } as Directive]);
      prefill(
        {
          queryLocation: ['router_one'],
          queryType: 'BGP Route',
          queryVariables: { location: 'default' },
        },
        byId,
      );

      expect(useFormState.getState().form.queryLocation).toEqual(['router_one']);
      expect(useFormState.getState().form.queryVariables).toEqual({ location: 'default' });
    });

    it('replaces the query type, target and variables of a query in the form', () => {
      useFormState.setState({
        form: {
          queryLocation: ['router_one'],
          queryType: '__hyperglass_juniper_bgp_route__',
          queryTarget: ['192.0.2.1'],
          queryVariables: { vrf: 'default' },
        },
        filtered: { types: device('router_one').directives, groups: [] },
        target: { display: '192.0.2.1' },
      });

      prefill({ queryLocation: ['router_one'], queryType: 'Ping' });

      const { form, target } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_juniper_ping__');
      expect(form.queryTarget).toEqual([]);
      expect(form.queryVariables).toEqual({});
      expect(target.display).toBe('');
    });

    it('leaves out the target and variables of an unknown query type, also when one is chosen', () => {
      // With only Ping offered, `locationChange` chooses it; the link's target was meant
      // for another query type.
      const ping = device('router_one').directives[3];
      const byId = routerOneWith([{ ...ping, variables: [vrf] } as Directive]);
      prefill(
        {
          queryLocation: ['router_one'],
          queryType: 'Traceroute',
          queryTarget: 'example.com',
          queryVariables: { vrf: 'default' },
        },
        byId,
      );

      const { form, target } = useFormState.getState();
      expect(form.queryType).toBe('__hyperglass_juniper_ping__');
      expect(form.queryTarget).toEqual([]);
      expect(form.queryVariables).toEqual({});
      expect(target.display).toBe('');
    });

    it.each([
      ['a line feed', '192.0.2.1\nshow running-config'],
      ['a carriage return', '192.0.2.1\r'],
      ['a NUL', '192.0.2.1\u0000'],
      ['a zero-width space', '2001:db8::\u200b1'],
      ['a line separator', '192.0.2.1\u2028'],
    ])('leaves out a target with %s', (_, value) => {
      prefill({ queryLocation: ['router_one'], queryType: 'BGP Route', queryTarget: value });

      expect(useFormState.getState().form.queryType).toBe('__hyperglass_juniper_bgp_route__');
      expect(useFormState.getState().form.queryTarget).toEqual([]);
      expect(useFormState.getState().target.display).toBe('');
    });

    it('sets variables named like Object properties, and no inherited value', () => {
      const route = device('router_one').directives[0];
      const constructorVar = { ...vrf, id: 'constructor', name: 'Constructor' };
      const toStringVar = { ...vrf, id: 'toString', name: 'To String' };
      const byId = routerOneWith([
        { ...route, variables: [constructorVar, toStringVar] } as Directive,
      ]);
      prefill(
        {
          queryLocation: ['router_one'],
          queryType: 'BGP Route',
          queryVariables: { toString: 'default' },
        },
        byId,
      );

      // `constructor` isn't in the link: the object's inherited `constructor` is no value.
      expect(useFormState.getState().form.queryVariables).toEqual({ toString: 'default' });
    });

    it('fills the form without submitting it', () => {
      prefill({ queryLocation: ['router_one'], queryType: 'BGP Route', queryTarget: '192.0.2.1' });

      expect(useFormState.getState().status).toBe('form');
      expect(useFormState.getState().loading).toBe(false);
      expect(useFormState.getState().resolvedIsOpen).toBe(false);
    });
  });

  it('back - drops the cached results of the last query, and nothing else', () => {
    useFormState.setState({ form: query, status: 'results', loading: true, resolvedIsOpen: true });
    useFormState.getState().addResponse('router_one', {} as QueryResponse);
    seedCache();

    useFormState.getState().back();

    const state = useFormState.getState();
    expect(state.loading).toBe(false);
    expect(state.resolvedIsOpen).toBe(false);
    expect(state.responses).toEqual({});
    expect(cachedQueryKeys()).toEqual([['/api/devices']]);
  });

  it('reset - clears every value and the cached results of the last query', async () => {
    useFormState.setState({
      form: query,
      status: 'results',
      loading: true,
      target: { display: '2001:db8::/32' },
      filtered: { types: device('router_one').directives, groups: ['IPv6'] },
      selections: {
        queryLocation: [{ value: 'router_one', label: 'Router One' }],
        queryType: null,
      },
    });
    seedCache();

    await useFormState.getState().reset();

    const state = useFormState.getState();
    expect(state.form.queryTarget).toEqual([]);
    expect(state.form.queryType).toBe('');
    expect(state.status).toBe('form');
    expect(state.loading).toBe(false);
    expect(state.target.display).toBe('');
    expect(state.filtered).toEqual({ types: [], groups: [] });
    expect(state.selections).toEqual({ queryLocation: [], queryType: null });
    expect(cachedQueryKeys()).toEqual([['/api/devices']]);
  });

  describe('useView', () => {
    it('is the form while the status is the form', () => {
      useFormState.setState({ form: query });
      const { result } = renderHook(() => useView());
      expect(result.current).toBe('form');
    });

    it('is the results once a complete query is submitted', () => {
      const { result } = renderHook(() => useView());
      act(() => useFormState.setState({ form: query, status: 'results' }));
      expect(result.current).toBe('results');
    });

    it.each([
      ['location', { queryLocation: [] }],
      ['query type', { queryType: '' }],
      ['target', { queryTarget: [] }],
    ])('stays on the form when the %s is missing', (_, missing) => {
      useFormState.setState({ form: { ...query, ...missing }, status: 'results' });
      const { result } = renderHook(() => useView());
      expect(result.current).toBe('form');
    });
  });

  describe('useFormInteractive', () => {
    it('is false for an untouched form', () => {
      const { result } = renderHook(() => useFormInteractive());
      expect(result.current).toBe(false);
    });

    it('is true once a location is selected', () => {
      const { result } = renderHook(() => useFormInteractive());
      act(() =>
        useFormState
          .getState()
          .setSelection('queryLocation', [{ value: 'router_one', label: 'Router One' }]),
      );
      expect(result.current).toBe(true);
    });

    it('is true while the results show', () => {
      const { result } = renderHook(() => useFormInteractive());
      act(() => useFormState.getState().setStatus('results'));
      expect(result.current).toBe(true);
    });
  });

  it('useFormSelections - follows the selections', () => {
    const { result } = renderHook(() => useFormSelections());
    expect(result.current.queryType).toBeNull();
    act(() => useFormState.getState().setSelection('queryType', { value: 'ping', label: 'Ping' }));
    expect(result.current.queryType).toEqual({ value: 'ping', label: 'Ping' });
  });
});

describe('parsePrefill', () => {
  it.each([
    ['an empty query string', ''],
    ['only other parameters', '?utm_source=mail&share=abc'],
    ['only empty values', '?location=&type=&target=&var.vrf='],
  ])('returns null for %s', (_, search) => {
    expect(parsePrefill(search)).toBeNull();
  });

  it('reads the locations, query type, target and variables', () => {
    expect(
      parsePrefill(
        '?location=router_one&location=router_two&type=BGP+Route&target=192.0.2.0%2F24&var.vrf=default',
      ),
    ).toEqual({
      queryLocation: ['router_one', 'router_two'],
      queryType: 'BGP Route',
      queryTarget: '192.0.2.0/24',
      queryVariables: { vrf: 'default' },
    });
  });

  it('reads the same query string with or without the leading question mark', () => {
    expect(parsePrefill('location=router_one')).toEqual(parsePrefill('?location=router_one'));
  });

  it.each([
    ['an encoded IPv6 address', 'target=2001%3Adb8%3A%3A1', '2001:db8::1'],
    ['an IPv6 prefix as typed', 'target=2001:db8::/32', '2001:db8::/32'],
    ['an IPv6 address with an encoded zone', 'target=fe80::1%25eth0', 'fe80::1%eth0'],
    ['a bracketed IPv6 address', 'target=%5B2001:db8::1%5D', '[2001:db8::1]'],
  ])('reads %s as the target', (_, search, target) => {
    expect(parsePrefill(`?location=router_one&${search}`)?.queryTarget).toBe(target);
  });

  it('keeps variables apart from the parameters with the same name', () => {
    expect(
      parsePrefill('?location=router_one&type=ping&var.location=default&var.type=customer'),
    ).toEqual({
      queryLocation: ['router_one'],
      queryType: 'ping',
      queryTarget: null,
      queryVariables: { location: 'default', type: 'customer' },
    });
  });

  it('reads each location once and the first of other repeated parameters', () => {
    expect(
      parsePrefill(
        '?location=router_one&location=router_one&type=a&type=b&target=c&target=d&var.vrf=e&var.vrf=f',
      ),
    ).toEqual({
      queryLocation: ['router_one'],
      queryType: 'a',
      queryTarget: 'c',
      queryVariables: { vrf: 'e' },
    });
  });

  it('reads variables named like Object properties', () => {
    expect(
      parsePrefill('?location=router_one&var.constructor=default&var.toString=customer')
        ?.queryVariables,
    ).toEqual({ constructor: 'default', toString: 'customer' });
  });

  it('skips a variable without an ID or a value', () => {
    expect(parsePrefill('?location=router_one&var.=default&var.vrf=')?.queryVariables).toEqual({});
  });
});

describe('withoutPrefill', () => {
  it('removes the parameters it reads and keeps the others in order', () => {
    expect(
      withoutPrefill(
        '?a=1&location=router_one&type=Ping&b=2&target=2001:db8::1&var.vrf=default&location=x',
      ),
    ).toBe('?a=1&b=2');
  });

  it('returns an empty query string when only its parameters are there', () => {
    expect(withoutPrefill('?location=router_one&target=')).toBe('');
  });

  it('keeps the other parameters as they were written', () => {
    expect(withoutPrefill('?q=a%20b&location=router_one&flag&r=x+y&var.vrf=default')).toBe(
      '?q=a%20b&flag&r=x+y',
    );
  });

  it('removes its parameters however their names are encoded', () => {
    expect(withoutPrefill('?%6Cocation=router_one&var%2Evrf=default&a=1')).toBe('?a=1');
  });

  it('returns a query string without its parameters unchanged', () => {
    expect(withoutPrefill('?q=a%20b')).toBe('?q=a%20b');
    expect(withoutPrefill('')).toBe('');
  });
});
