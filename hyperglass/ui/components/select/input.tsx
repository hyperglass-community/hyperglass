import { components } from 'react-select';

import type { GroupBase, InputProps } from 'react-select';
import type { SingleOption } from '~/types';

/**
 * react-select's input, also described by the field's error message. react-select sets
 * `aria-describedby` itself (to its placeholder or live region) and doesn't take one, but
 * passes `aria-errormessage` on, which `Select` sets only while the field is invalid.
 */
export const Input = <Opt extends SingleOption, IsMulti extends boolean>(
  props: InputProps<Opt, IsMulti, GroupBase<Opt>>,
): JSX.Element => {
  const error = props.selectProps['aria-errormessage'];
  const describedBy = [props['aria-describedby'], error].filter(Boolean).join(' ');
  return (
    <components.Input<Opt, IsMulti, GroupBase<Opt>>
      {...props}
      aria-describedby={describedBy === '' ? undefined : describedBy}
    />
  );
};
