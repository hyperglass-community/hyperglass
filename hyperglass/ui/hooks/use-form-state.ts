import intersectionWith from 'lodash/intersectionWith';
import plur from 'plur';
import { useMemo } from 'react';
import isEqual from 'react-fast-compare';
import create from 'zustand';
import { queryClient } from '~/context';
import { isSelectDirective } from '~/types';
import { all, andJoin, dedupObjectArray, withDev } from '~/util';

import type { UseFormClearErrors, UseFormSetError } from 'react-hook-form';
import type { MultiValue, SingleValue } from 'react-select';
import type { StateCreator } from 'zustand';
import type { Device, Directive, FormData, SingleOption, Text } from '~/types';
import type { UseDeviceReturn } from './use-device';

type FormStatus = 'form' | 'results';

interface FormValues {
  queryLocation: string[];
  queryTarget: string[];
  queryType: string;
  queryVariables: Record<string, string>;
}

/**
 * Selected *options*, vs. values.
 */
interface FormSelections<Opt extends SingleOption = SingleOption> {
  queryLocation: MultiValue<Opt>;
  queryType: SingleValue<Opt>;
}

interface Filtered {
  types: Directive[];
  groups: string[];
}

interface Responses {
  [deviceId: string]: QueryResponse;
}

interface Target {
  display: string;
}

/**
 * Form values read from a link (see `parsePrefill`), not yet checked against the
 * configuration. `prefillForm` applies the ones the configuration allows.
 */
export interface FormPrefill {
  /** Location (device) IDs. */
  queryLocation: string[];
  /** A query type's directive ID or name. */
  queryType: string | null;
  queryTarget: string | null;
  /** Variable values by variable ID. */
  queryVariables: Record<string, string>;
}

/** What `locationChange` and `prefillForm` need from the form. */
interface LocationChangeExtra {
  setError: UseFormSetError<FormData>;
  clearErrors: UseFormClearErrors<FormData>;
  getDevice: UseDeviceReturn;
  text: Text;
}

/** Query parameter prefix of directive variables, e.g. `var.vrf=default`. */
const VARIABLE_PARAM = 'var.';

/**
 * Read form values from a URL query string such as `window.location.search`:
 * `?location=<id>&location=<id>&type=<id or name>&target=<value>&var.<id>=<value>`.
 *
 * Variables are namespaced because a variable may be named `location` or `type`. Empty
 * values are skipped; for `type`, `target` and each variable the first value is used.
 * Returns `null` when the query string has none of these parameters.
 */
export function parsePrefill(search: string): FormPrefill | null {
  const params = new URLSearchParams(search);
  const queryLocation = Array.from(new Set(params.getAll('location').filter(l => l !== '')));
  const queryType = params.get('type') || null;
  const queryTarget = params.get('target') || null;
  const queryVariables: Record<string, string> = {};
  for (const [key, value] of params) {
    const id = key.slice(VARIABLE_PARAM.length);
    if (key.startsWith(VARIABLE_PARAM) && id !== '' && value !== '' && !(id in queryVariables)) {
      queryVariables[id] = value;
    }
  }
  if (
    queryLocation.length === 0 &&
    queryType === null &&
    queryTarget === null &&
    Object.keys(queryVariables).length === 0
  ) {
    return null;
  }
  return { queryLocation, queryType, queryTarget, queryVariables };
}

/**
 * The query string without the parameters `parsePrefill` reads, keeping the others:
 * `''` or a string that starts with `?`. Without such parameters, `search` unchanged.
 */
export function withoutPrefill(search: string): string {
  const params = new URLSearchParams(search);
  const read = Array.from(params.keys()).filter(
    key => ['location', 'type', 'target'].includes(key) || key.startsWith(VARIABLE_PARAM),
  );
  if (read.length === 0) {
    return search;
  }
  for (const key of read) {
    params.delete(key);
  }
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}

interface FormStateType<Opt extends SingleOption = SingleOption> {
  // Values
  filtered: Filtered;
  form: FormValues;
  loading: boolean;
  responses: Responses;
  selections: FormSelections<Opt>;
  status: FormStatus;
  target: Target;
  resolvedIsOpen: boolean;

  // Methods
  resolvedOpen(): void;
  resolvedClose(): void;
  response(deviceId: string): QueryResponse | null;
  addResponse(deviceId: string, data: QueryResponse): void;
  setLoading(value: boolean): void;
  setStatus(value: FormStatus): void;
  setSelection<
    Opt extends SingleOption,
    K extends keyof FormSelections<Opt> = keyof FormSelections<Opt>,
  >(field: K, value: FormSelections[K]): void;
  setTarget(update: Partial<Target>): void;
  getDirective(): Directive | null;
  reset(): Promise<void>;
  back(): void;
  setFormValue<K extends keyof FormValues>(field: K, value: FormValues[K]): void;
  locationChange(locations: string[], extra: LocationChangeExtra): void;
  prefillForm(prefill: FormPrefill, extra: LocationChangeExtra): void;
}

/**
 * Whether `to` offers the target entered for `from`, a directive of the same name: it
 * takes the same kind of target and, for a select, offers every selected value.
 */
function offersTarget(from: Directive, to: Directive, target: string[]): boolean {
  if (from.fieldType !== to.fieldType) {
    return false;
  }
  if (isSelectDirective(to)) {
    return target.every(value => to.options.some(option => option.value === value));
  }
  return true;
}

/** The variable values that `directive` defines and offers, keyed by variable ID. */
function offeredVariables(
  directive: Directive,
  values: Record<string, string>,
): Record<string, string> {
  const variables = directive.variables ?? [];
  return Object.fromEntries(
    Object.entries(values).filter(([id, value]) =>
      variables.some(v => v.id === id && v.options.some(option => option.value === value)),
    ),
  );
}

const formState: StateCreator<FormStateType> = (set, get) => ({
  filtered: { types: [], groups: [] },
  form: { queryLocation: [], queryTarget: [], queryType: '', queryVariables: {} },
  loading: false,
  responses: {},
  selections: { queryLocation: [], queryType: null },
  status: 'form',
  target: { display: '' },
  resolvedIsOpen: false,

  setFormValue<K extends keyof FormValues>(field: K, value: FormValues[K]): void {
    set(state => ({ form: { ...state.form, [field]: value } }));
  },

  setLoading(loading: boolean): void {
    set({ loading });
  },

  setStatus(status: FormStatus): void {
    set({ status });
  },

  setSelection<
    Opt extends SingleOption,
    K extends keyof FormSelections<Opt> = keyof FormSelections<Opt>,
  >(field: K, value: FormSelections[K]): void {
    set(state => ({ selections: { ...state.selections, [field]: value } }));
  },

  setTarget(update: Partial<Target>): void {
    set(state => ({ target: { ...state.target, ...update } }));
  },

  resolvedOpen(): void {
    set({ resolvedIsOpen: true });
  },

  resolvedClose(): void {
    set({ resolvedIsOpen: false });
  },

  addResponse(deviceId: string, data: QueryResponse): void {
    set(state => ({ responses: { ...state.responses, [deviceId]: data } }));
  },

  getDirective(): Directive | null {
    const { form, filtered } = get();
    const [matching] = filtered.types.filter(t => t.id === form.queryType);
    if (typeof matching !== 'undefined') {
      return matching;
    }
    return null;
  },

  locationChange(locations: string[], extra: LocationChangeExtra): void {
    const { setError, clearErrors, getDevice, text } = extra;

    // The current query type's directive among the ones offered until now.
    const previous = get().getDirective();

    clearErrors('queryLocation');
    set(state => ({ form: { ...state.form, queryLocation: locations } }));

    // Get device configuration objects for each selected location ID.
    const allDevices = locations
      .map(getDevice)
      .filter((device): device is Device => device !== null);

    // Determine all unique group names.
    const allGroups = allDevices.map(dev =>
      Array.from(new Set(dev.directives.flatMap(dir => dir.groups))),
    );

    // Get group names that are common between all selected locations.
    const intersecting = intersectionWith(...allGroups, isEqual);

    // Get all directives of all selected devices.
    const allDirectives = locations
      .map(getDevice)
      .filter((device): device is Device => device !== null)
      .map(device => device.directives);

    // Get directive objects that are common between selected locations. Builtin
    // directives are vendor-specific by `id` but share a `name` across platforms, so
    // deep equality would intersect a multi-vendor selection to nothing. The backend
    // resolves the resulting id back to each device's own directive by that name.
    const intersectingDirectives = intersectionWith(
      ...allDirectives,
      (a: Directive, b: Directive) => a.name === b.name,
    );

    // Deduplicate all intersecting directives by ID.
    const directives = dedupObjectArray(intersectingDirectives, 'id');

    set({ filtered: { groups: intersecting, types: directives } });

    const { selections, form } = get();
    if (
      (form.queryLocation.length > 1 || locations.length > 1) &&
      intersectingDirectives.length === 0
    ) {
      const start = plur(text.queryLocation, selections.queryLocation.length);
      const locationsAnd = andJoin(selections.queryLocation.map(s => s.label));
      const types = plur(text.queryType, 2);
      const message = `${start} ${locationsAnd} have no ${types} in common.`;
      setError('queryLocation', { message });
    }

    // Keep the current query type if the new locations still offer it. Directives are
    // intersected by `name` and the offered IDs are the first location's, so the same
    // query type can be offered under another ID: follow it there.
    const kept =
      previous === null
        ? undefined
        : directives.find(d => d.id === previous.id) ??
          directives.find(d => d.name === previous.name);

    if (kept !== undefined && previous !== null) {
      if (kept.id !== previous.id) {
        // The same query type under another ID. Builtin directives differ only by vendor,
        // but two custom directives can share a name and nothing else, so keep only what
        // the new directive offers: values it doesn't define would be submitted unseen
        // and rejected (or, for a select target, shown in a field that no longer offers
        // them). A text target stays, as it is shown and checked against the new rules.
        // While several locations stay selected, the same values go to each location's
        // directive of that name, so custom directives that share a name must also share
        // their variables and options, or the other locations reject the query.
        set(state => {
          const keepTarget = offersTarget(previous, kept, state.form.queryTarget);
          return {
            form: {
              ...state.form,
              queryType: kept.id,
              queryTarget: keepTarget ? state.form.queryTarget : [],
              queryVariables: offeredVariables(kept, state.form.queryVariables),
            },
            selections: { ...state.selections, queryType: { value: kept.id, label: kept.name } },
            target: keepTarget ? state.target : { display: '' },
          };
        });
      }
    } else if (intersectingDirectives.length === 1) {
      // If there is only one intersecting directive, choose it so the user doesn't have to.
      // It isn't the current query type (that one would be kept above), so clear the
      // target as choosing another query type does: it may expect another kind of target.
      const [only] = intersectingDirectives;
      set(state => ({
        form: { ...state.form, queryType: only.id, queryTarget: [], queryVariables: {} },
        // Select the option too, so the query type select shows it.
        selections: { ...state.selections, queryType: { value: only.id, label: only.name } },
        target: { display: '' },
      }));
    } else if (form.queryType !== '') {
      // The new locations don't offer the current query type: clear it and what depends
      // on it, as choosing another query type does.
      set(state => ({
        form: { ...state.form, queryType: '', queryTarget: [], queryVariables: {} },
        selections: { ...state.selections, queryType: null },
        target: { display: '' },
      }));
    }
  },

  prefillForm(prefill: FormPrefill, extra: LocationChangeExtra): void {
    // Each value goes through the same steps as the user's input, in the form's order,
    // so a value the configuration doesn't offer is left out as the form would.
    const devices = prefill.queryLocation
      .map(extra.getDevice)
      .filter((device): device is Device => device !== null);
    if (devices.length === 0) {
      // The query type, target and variables depend on a location.
      return;
    }

    // Locations: as `QueryLocation` does, select the options, then change the locations.
    set(state => ({
      selections: {
        ...state.selections,
        queryLocation: devices.map(d => ({ value: d.id, label: d.name })),
      },
    }));
    get().locationChange(
      devices.map(d => d.id),
      extra,
    );

    // Query type: by the ID of an offered directive, then by name. Offered directives
    // carry the first location's IDs, so another selected location's ID for the same
    // query type is matched by that directive's name, as the backend resolves it.
    const offered = get().filtered.types;
    const wanted = prefill.queryType;
    const ofLocation = devices.flatMap(d => d.directives).find(d => d.id === wanted);
    const queryType =
      wanted === null
        ? undefined
        : offered.find(d => d.id === wanted) ??
          offered.find(d => d.name === wanted) ??
          offered.find(d => d.name === ofLocation?.name);
    if (queryType !== undefined && queryType.id !== get().form.queryType) {
      // As choosing a query type does, clear the target and variables.
      set(state => ({
        form: { ...state.form, queryType: queryType.id, queryTarget: [], queryVariables: {} },
        selections: {
          ...state.selections,
          queryType: { value: queryType.id, label: queryType.name },
        },
        target: { display: '' },
      }));
    }

    // The target and variables of the query type now selected, whether it came from the
    // link or was the only one offered.
    const directive = get().getDirective();
    if (directive === null) {
      return;
    }
    // A directive without a field type has no target; the form fills in its own. A
    // select target must be one of the options. A text target is checked on submit, as
    // a typed one is.
    const target = prefill.queryTarget;
    if (
      target !== null &&
      directive.fieldType !== null &&
      (!isSelectDirective(directive) || directive.options.some(o => o.value === target))
    ) {
      set(state => ({
        form: { ...state.form, queryTarget: [target] },
        target: { display: target },
      }));
    }

    const variables: Record<string, string> = {};
    for (const variable of directive.variables ?? []) {
      const value = prefill.queryVariables[variable.id];
      if (variable.options.some(o => o.value === value)) {
        variables[variable.id] = value;
      }
    }
    set(state => ({
      form: { ...state.form, queryVariables: { ...state.form.queryVariables, ...variables } },
    }));
  },

  response(deviceId: string): QueryResponse | null {
    const { responses } = get();
    for (const [id, response] of Object.entries(responses)) {
      if (id === deviceId) {
        return response;
      }
    }
    return null;
  },

  back(): void {
    // Return to the form and keep the last query, so it can be changed and resubmitted.
    const { form } = get();
    set({ loading: false, responses: {}, status: 'form', resolvedIsOpen: false });
    for (const queryLocation of form.queryLocation) {
      const query = {
        queryLocation,
        queryTarget: form.queryTarget,
        queryType: form.queryType,
        queryVariables: form.queryVariables,
      };
      queryClient.removeQueries({ queryKey: ['/api/query', query] });
    }
  },

  async reset(): Promise<void> {
    const { form } = get();
    set({
      filtered: { types: [], groups: [] },
      form: { queryLocation: [], queryTarget: [], queryType: '', queryVariables: {} },
      loading: false,
      responses: {},
      selections: { queryLocation: [], queryType: null },
      status: 'form',
      target: { display: '' },
      resolvedIsOpen: false,
    });
    for (const queryLocation of form.queryLocation) {
      const query = {
        queryLocation,
        queryTarget: form.queryTarget,
        queryType: form.queryType,
        queryVariables: form.queryVariables,
      };
      queryClient.removeQueries({ queryKey: ['/api/query', query] });
    }
  },
});

export const useFormState = create<FormStateType>(
  withDev<FormStateType>(formState, 'useFormState'),
);

export function useFormSelections<Opt extends SingleOption = SingleOption>(): FormSelections<Opt> {
  return useFormState(s => s.selections as FormSelections<Opt>);
}

export function useView(): FormStatus {
  const { status, form } = useFormState(({ status, form }) => ({ status, form }));
  return useMemo(() => {
    const ready = all(
      status === 'results',
      form.queryLocation.length !== 0,
      form.queryType !== '',
      form.queryTarget.length !== 0,
    );
    return ready ? 'results' : 'form';
  }, [status, form]);
}

export function useFormInteractive(): boolean {
  const { status, selections } = useFormState(({ status, selections }) => ({ status, selections }));
  return status === 'results' || selections.queryLocation.length > 0;
}
