import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFormState } from './use-form-state';

import type { Directive } from '~/types';

export function useDirective(): Nullable<Directive> {
  const { getDirective, form } = useFormState(
    useShallow(({ getDirective, form }) => ({ getDirective, form })),
  );

  return useMemo<Nullable<Directive>>(() => {
    if (form.queryType === '') {
      return null;
    }
    const directive = getDirective();
    return directive;
    // form.queryType also triggers a re-run: getDirective() reads it from the store.
  }, [form.queryType, getDirective]);
}
