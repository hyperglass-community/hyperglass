import { Flex, ScaleFade, SlideFade, chakra } from '@chakra-ui/react';
import { vestResolver } from '@hookform/resolvers/vest';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import isEqual from 'react-fast-compare';
import { FormProvider, useForm } from 'react-hook-form';
import vest, { test, enforce } from 'vest';
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
  parsePrefill,
  useDevice,
  useFormState,
  useGreeting,
  useStrf,
  withoutPrefill,
} from '~/hooks';
import { Directive, isQueryField, isString } from '~/types';
import { isFQDN } from '~/util';

import type { FormData, OnChangeArgs } from '~/types';

/** The store's form values before a query is entered, and after a reset. */
const EMPTY_VALUES: FormData = {
  queryLocation: [],
  queryType: '',
  queryTarget: [],
  queryVariables: {},
};

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
    useCallback(({ form, filtered, selections }) => ({ form, filtered, selections }), []),
    isEqual,
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

  // Fill the form from the parameters of the address, once the router is ready: the
  // page is exported statically, and Next.js replaces the address once it has read the
  // query string after hydration. This only fills the form: submitting still goes
  // through `submitHandler`, with its greeting check and hostname resolution. The store
  // change reaches react-hook-form through the mirror below.
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
      router.replace(`${pathname}${rest}${hash}`, undefined, { shallow: true, scroll: false });
    }
  }, [router.isReady]);

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

  return (
    <FormProvider {...formInstance}>
      <chakra.form
        p={0}
        my={4}
        w="100%"
        mx="auto"
        textAlign="left"
        maxW={{ base: '100%', lg: '75%' }}
        onSubmit={handleSubmit(submitHandler)}
      >
        <FormRow>
          <FormField name="queryLocation" label={web.text.queryLocation}>
            <QueryLocation onChange={handleChange} label={web.text.queryLocation} />
          </FormField>
        </FormRow>
        <FormRow>
          <SlideFade offsetX={-100} in={filtered.types.length > 0} unmountOnExit>
            <FormField
              name="queryType"
              label={web.text.queryType}
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
              <FormField name="queryTarget" label={web.text.queryTarget}>
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
              <FormField key={variable.id} name={variable.id} label={variable.name}>
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
