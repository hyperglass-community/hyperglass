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
  locationChange(
    locations: string[],
    extra: {
      setError: UseFormSetError<FormData>;
      clearErrors: UseFormClearErrors<FormData>;
      getDevice: UseDeviceReturn;
      text: Text;
    },
  ): void;
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

  locationChange(
    locations: string[],
    extra: {
      setError: UseFormSetError<FormData>;
      clearErrors: UseFormClearErrors<FormData>;
      getDevice: UseDeviceReturn;
      text: Text;
    },
  ): void {
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
