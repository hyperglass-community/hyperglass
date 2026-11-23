import { Flex, ScaleFade, SlideFade, chakra } from '@chakra-ui/react';
import { vestResolver } from '@hookform/resolvers/vest';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import isEqual from 'react-fast-compare';
import { FormProvider, useForm } from 'react-hook-form';
import vest, { test, enforce } from 'vest';
import { useShallow } from 'zustand/react/shallow';
import {
  DirectiveInfoModal,
  FormField,
  QueryLocation,
  QueryTarget,
  QueryType,
  QueryVariable,
  SubmitButton,
} from '~/components';
import { useConfig } from '~/context';
import { FormRow } from '~/elements';
import {
  historyPrefill,
  parsePrefill,
  useDevice,
  useFormState,
  useGreeting,
  useHistoryView,
  useStrf,
  withoutPrefill,
} from '~/hooks';
import { Directive, isQueryField, isString } from '~/types';
import { isFQDN } from '~/util';

import type { FieldErrors } from 'react-hook-form';
import type { FormData, OnChangeArgs } from '~/types';

/** The store's form values before a query is entered, and after a reset. */
const EMPTY_VALUES: FormData = {
  queryLocation: [],
  queryType: '',
  queryTarget: [],
  queryVariables: {},
};

/** What follows once a saved query fills the form: submit it, or focus the first field found. */
type AfterReuse = { submit: true } | { focus: string[] };

/** The `data-query-field` of the Submit button's row. */
const SUBMIT_FIELD = 'submit';

/**
 * Focus the control of the first of `names` that has one: its input, else its first
 * button. A name is a form row's `data-query-field`: `queryLocation`, `queryType`,
 * `queryTarget`, `var.<variable ID>` or `submit`. Location cards have no control.
 */
function focusField(form: HTMLFormElement | null, names: string[]): void {
  const fields = Array.from(form?.querySelectorAll<HTMLElement>('[data-query-field]') ?? []);
  for (const name of names) {
    const field = fields.find(f => f.dataset.queryField === name);
    const control =
      field?.querySelector<HTMLElement>('input:not([hidden]):not([type="hidden"])') ??
      field?.querySelector<HTMLElement>('button');
    if (control !== null && control !== undefined) {
      control.focus();
      return;
    }
  }
}

export const LookingGlassForm = (): JSX.Element => {
  const { web, messages } = useConfig();
  const router = useRouter();

  const greetingReady = useGreeting(s => s.greetingReady);

  const getDevice = useDevice();
  const strF = useStrf();
  const setLoading = useFormState(s => s.setLoading);
  const setStatus = useFormState(s => s.setStatus);
  const locationChange = useFormState(s => s.locationChange);
  const prefillForm = useFormState(s => s.prefillForm);
  const setTarget = useFormState(s => s.setTarget);
  const setFormValue = useFormState(s => s.setFormValue);
  const { form, filtered, selections } = useFormState(
    useShallow(({ form, filtered, selections }) => ({ form, filtered, selections })),
  );
  // The store's own values object, compared by reference, so the mirror below also runs
  // when a reset replaces values that were already empty.
  const values = useFormState(s => s.form);

  const getDirective = useFormState(useCallback(s => s.getDirective, []));
  const resolvedOpen = useFormState(useCallback(s => s.resolvedOpen, []));
  const resetForm = useFormState(useCallback(s => s.reset, []));

  const noQueryType = strF(messages.noInput, { field: web.text.queryType });
  const noQueryLoc = strF(messages.noInput, { field: web.text.queryLocation });
  const noQueryTarget = strF(messages.noInput, { field: web.text.queryTarget });

  const queryTypes = useMemo(() => filtered.types.map(t => t.id), [filtered.types]);

  const formSchema = vest.create((data: FormData = {} as FormData) => {
    test('queryLocation', noQueryLoc, () => {
      enforce(data.queryLocation).isArrayOf(enforce.isString()).isNotEmpty();
    });
    test('queryTarget', noQueryTarget, () => {
      // Every target needs a value: a cleared text input leaves `['']`.
      enforce(data.queryTarget).isArrayOf(enforce.isString().matches(/\S/)).isNotEmpty();
    });
    test('queryType', noQueryType, () => {
      enforce(data.queryType).inside(queryTypes);
    });
    for (const variable of directive?.variables ?? []) {
      if (variable.required) {
        test(variable.id, strF(messages.noInput, { field: variable.name }), () => {
          enforce(data.queryVariables?.[variable.id]).isNotEmpty();
        });
      }
    }
  });

  const formInstance = useForm<FormData>({
    resolver: vestResolver(formSchema),
    defaultValues: {
      queryTarget: [],
      queryLocation: [],
      queryType: '',
    },
  });

  const { handleSubmit, register, reset, setValue, setError, clearErrors } = formInstance;
  const formRef = useRef<HTMLFormElement>(null);

  const isFqdnQuery = useCallback(
    (target: string | string[], fieldType: Directive['fieldType'] | null): boolean =>
      (typeof target === 'string' || Array.isArray(target)) &&
      fieldType === 'text' &&
      isFQDN(target),
    [],
  );

  const directive = useMemo<Directive | null>(() => {
    const tmp = getDirective();
    if (tmp !== null && tmp.fieldType === null) {
      setFormValue('queryTarget', ['null']);
      setValue('queryTarget', ['null']);
    }
    return tmp;
  }, [form.queryType, form.queryLocation, getDirective]);

  async function submitHandler(): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      console.table({
        'Query Location': form.queryLocation.toString(),
        'Query Type': form.queryType,
        'Query Target': form.queryTarget,
        'Selected Directive': directive?.name ?? null,
      });
    }

    // Note: IP enrichment refresh is now handled server-side on query
    // submission when enabled. Removing client-side best-effort refresh
    // to centralize refresh logic and avoid redundant requests from many
    // clients.

    // Before submitting a query, make sure the greeting is acknowledged if required. This should
    // be handled before loading the app, but people be sneaky.
    if (!greetingReady) {
      resetForm();
      location.reload();
      return;
    }

    // Determine if queryTarget is an FQDN.
    const isFqdn = isFqdnQuery(form.queryTarget, directive?.fieldType ?? null);

    if (greetingReady && !isFqdn) {
      setStatus('results');
      return;
    }

    if (greetingReady && isFqdn) {
      setLoading(true);
      resolvedOpen();
      return;
    }
    console.group('%cSomething went wrong', 'color:red;');
    console.table({
      'Greeting Required': web.greeting.required,
      'Greeting Ready': greetingReady,
      'Query Target': form.queryTarget,
      'Query Type': form.queryType,
      'Is FQDN': isFqdn,
    });
    console.groupEnd();
  }

  const handleLocChange = (locations: string[]) =>
    locationChange(locations, { setError, clearErrors, getDevice, text: web.text });

  function handleChange(e: OnChangeArgs): void {
    // Signal the field & value to react-hook-form.
    if (isQueryField(e.field)) {
      setValue(e.field, e.value);
    } else {
      throw new Error(`Field '${e.field}' is not a valid form field.`);
    }

    if (e.field === 'queryLocation' && Array.isArray(e.value)) {
      handleLocChange(e.value);
    } else if (e.field === 'queryType' && isString(e.value)) {
      setValue('queryType', e.value);
      setFormValue('queryType', e.value);
      setFormValue('queryVariables', {});
      setValue('queryVariables', {});
      if (form.queryTarget.length !== 0) {
        // Reset queryTarget as well, so that, for example, selecting BGP Community, and selecting
        // a community, then changing the queryType to BGP Route doesn't preserve the selected
        // community as the queryTarget.
        setFormValue('queryTarget', []);
        setTarget({ display: '' });
      }
    } else if (e.field === 'queryTarget') {
      if (isString(e.value)) {
        setFormValue('queryTarget', [e.value]);
        setValue('queryTarget', [e.value]);
      }
      if (Array.isArray(e.value)) {
        setFormValue('queryTarget', e.value);
        setValue('queryTarget', e.value);
      }
    }
  }

  function handleVariableChange(id: string, value: string | null): void {
    const { queryVariables } = useFormState.getState().form;
    const { [id]: _, ...rest } = queryVariables;
    const updated = value === null ? rest : { ...rest, [id]: value };
    setFormValue('queryVariables', updated);
    setValue('queryVariables', updated);
    clearErrors(id as keyof FormData);
  }

  useEffect(() => {
    register('queryLocation', { required: true });
    register('queryType', { required: true });
  }, [register]);

  // The store is the source of the form values; mirror it into react-hook-form, which
  // validates them. This covers values the store sets on its own: the previous query
  // restored after returning from results, the query type chosen when the selected
  // locations have only one, and a reset from the header.
  useEffect(() => {
    if (isEqual(values, EMPTY_VALUES)) {
      // The store was reset (or every value was removed): reset react-hook-form as well,
      // so the errors and submitted state of the previous query go with its values.
      reset(values);
      return;
    }
    setValue('queryLocation', values.queryLocation);
    setValue('queryType', values.queryType);
    setValue('queryTarget', values.queryTarget);
    setValue('queryVariables', values.queryVariables);
  }, [values, reset, setValue]);

  // Fill the form from the parameters of the address, once the router is ready: the
  // page is exported statically, and Next.js replaces the address once it has read the
  // query string after hydration. This only fills the form: submitting still goes
  // through `submitHandler`, with its greeting check and hostname resolution. The store
  // change reaches react-hook-form through the mirror above. This effect comes after
  // the mirror: on a mount with the router already ready, the mirror's reset of the
  // empty form would otherwise clear an error that `locationChange` sets here.
  const prefillRead = useRef(false);
  useEffect(() => {
    if (!router.isReady || prefillRead.current) {
      return;
    }
    prefillRead.current = true;
    const { pathname, search, hash } = window.location;
    const prefill = parsePrefill(search);
    if (prefill !== null) {
      prefillForm(prefill, { setError, clearErrors, getDevice, text: web.text });
    }
    // Remove the parameters once read. The form unmounts while the results show, so
    // they would otherwise be applied again over the user's changes on its return, and
    // the address would no longer describe the form. Through the router, so the history
    // entries Next.js keeps (and Back restores) have the new address too.
    const rest = withoutPrefill(search);
    if (rest !== search) {
      // The route is the page's, not the address's path: the page can also be served as
      // `/index.html`, which is not a route and would load the page again.
      router.replace(`${router.pathname}${rest}`, `${pathname}${rest}${hash}`, {
        shallow: true,
        scroll: false,
      });
    }
  }, [router.isReady]);

  // A saved query from the history (Run again or New target), which the form takes once,
  // after the effects above. It fills the form as a link does; Run again then submits
  // through `submitHandler`, with its greeting check and hostname resolution, once the
  // values are rendered (see `afterReuse`).
  const pendingReuse = useHistoryView(s => s.pending);
  const [afterReuse, setAfterReuse] = useState<AfterReuse | null>(null);
  useEffect(() => {
    const reuse = pendingReuse === null ? null : useHistoryView.getState().takeReuse();
    if (reuse === null) {
      return;
    }
    const { query, locations, mode } = reuse;
    // The errors of what the form had before.
    clearErrors();
    const prefill = historyPrefill(query, getDevice);
    prefillForm(mode === 'newTarget' ? { ...prefill, queryTarget: null } : prefill, {
      setError,
      clearErrors,
      getDevice,
      text: web.text,
    });
    // `prefillForm` leaves out what the configuration no longer has; name the locations.
    const unavailable = query.queryLocation.flatMap((id, index) =>
      getDevice(id) === null ? [locations[index] ?? id] : [],
    );
    if (unavailable.length > 0) {
      setError('queryLocation', {
        message: strF(web.text.historyLocationUnavailable, { locations: unavailable.join(', ') }),
      });
    }
    // Name each saved variable value the selected query type no longer offers, on its
    // field. (A variable the query type no longer has has no field to show it.)
    const after = useFormState.getState();
    const selected = after.getDirective();
    const droppedVariables = Object.entries(query.queryVariables).filter(
      ([id, value]) =>
        after.form.queryVariables[id] !== value &&
        (selected?.variables ?? []).some(v => v.id === id),
    );
    for (const [id, value] of droppedVariables) {
      setError(id as keyof FormData, {
        message: strF(web.text.historyVariableUnavailable, { value }),
      });
    }
    if (mode === 'newTarget') {
      setAfterReuse({ focus: ['queryTarget', 'queryType', 'queryLocation'] });
      return;
    }
    // Run the saved query only as it was saved. Anything `prefillForm` left out or chose
    // on its own makes another query: a location, the query type (when the saved one is
    // gone, `locationChange` may choose the only one left, and one without a target field
    // gets the form's placeholder target, so validation would pass), the target, or a
    // variable value. Then only fill the form and focus the first field that differs.
    const sameType =
      selected !== null &&
      (selected.id === query.queryType || selected.name === query.queryTypeName);
    const sameTarget =
      selected !== null &&
      (selected.fieldType === null
        ? isEqual(query.queryTarget, ['null'])
        : isEqual(after.form.queryTarget, query.queryTarget));
    const sameVariables = Object.entries(query.queryVariables).every(
      ([id, value]) => after.form.queryVariables[id] === value,
    );
    if (unavailable.length === 0 && sameType && sameTarget && sameVariables) {
      setAfterReuse({ submit: true });
      return;
    }
    setAfterReuse({
      focus: [
        ...(unavailable.length > 0 ? ['queryLocation'] : []),
        ...(sameType ? [] : ['queryType']),
        ...(sameType && !sameTarget && selected?.fieldType !== null ? ['queryTarget'] : []),
        ...droppedVariables.map(([id]) => `var.${id}`),
        SUBMIT_FIELD,
      ],
    });
  }, [pendingReuse]);

  // On the render after a saved query filled the form, so `submitHandler`, the schema and
  // react-hook-form (through the mirror above) have its values.
  useEffect(() => {
    if (afterReuse === null) {
      return;
    }
    setAfterReuse(null);
    if ('focus' in afterReuse) {
      focusField(formRef.current, afterReuse.focus);
      return;
    }
    const order: [string, string][] = [
      ['queryLocation', 'queryLocation'],
      ['queryType', 'queryType'],
      ['queryTarget', 'queryTarget'],
      // A variable's row is named apart from the others, as in a link (`var.<id>`).
      ...(directive?.variables ?? []).map((v): [string, string] => [v.id, `var.${v.id}`]),
    ];
    const onInvalid = (errors: FieldErrors<FormData>) =>
      focusField(
        formRef.current,
        order.filter(([error]) => error in errors).map(([, field]) => field),
      );
    void handleSubmit(submitHandler, onInvalid)();
  }, [afterReuse]);

  return (
    <FormProvider {...formInstance}>
      <chakra.form
        ref={formRef}
        p={0}
        my={4}
        w="100%"
        mx="auto"
        textAlign="left"
        maxW={{ base: '100%', lg: '75%' }}
        onSubmit={handleSubmit(submitHandler)}
      >
        <FormRow>
          <FormField
            name="queryLocation"
            label={web.text.queryLocation}
            data-query-field="queryLocation"
          >
            <QueryLocation onChange={handleChange} label={web.text.queryLocation} />
          </FormField>
        </FormRow>
        <FormRow>
          <SlideFade offsetX={-100} in={filtered.types.length > 0} unmountOnExit>
            <FormField
              name="queryType"
              label={web.text.queryType}
              data-query-field="queryType"
              labelAddOn={
                directive !== null && (
                  <DirectiveInfoModal
                    name="queryType"
                    title={directive.name ?? null}
                    item={directive.info ?? null}
                    visible={selections.queryType !== null && directive.info !== null}
                  />
                )
              }
            >
              <QueryType onChange={handleChange} label={web.text.queryType} />
            </FormField>
          </SlideFade>
          <SlideFade
            offsetX={100}
            in={directive !== null && directive.fieldType !== null}
            unmountOnExit
          >
            {directive !== null && (
              <FormField
                name="queryTarget"
                label={web.text.queryTarget}
                data-query-field="queryTarget"
              >
                <QueryTarget
                  name="queryTarget"
                  register={register}
                  onChange={handleChange}
                  placeholder={directive.description}
                />
              </FormField>
            )}
          </SlideFade>
        </FormRow>
        {directive !== null && (directive.variables ?? []).length > 0 && (
          <FormRow>
            {(directive.variables ?? []).map(variable => (
              <FormField
                key={variable.id}
                name={variable.id}
                label={variable.name}
                data-query-field={`var.${variable.id}`}
              >
                <QueryVariable variable={variable} onChange={handleVariableChange} />
              </FormField>
            ))}
          </FormRow>
        )}
        <FormRow mt={0} justifyContent="flex-end">
          <Flex
            my={2}
            w="100%"
            ml="auto"
            maxW="100%"
            flex="0 0 0"
            flexDir="column"
            mr={{ base: 0, lg: 2 }}
            data-query-field={SUBMIT_FIELD}
          >
            <ScaleFade initialScale={0.5} in={form.queryTarget.length !== 0}>
              <SubmitButton />
            </ScaleFade>
          </Flex>
        </FormRow>
      </chakra.form>
    </FormProvider>
  );
};
