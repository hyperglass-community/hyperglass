import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { testConfig } from '~/__tests__/render';
import { queryClient } from '~/context';
import { useFormInteractive, useFormSelections, useFormState, useView } from './use-form-state';

import type { Device } from '~/types';

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
