import { useDisclosure, useFormControlContext } from '@chakra-ui/react';
import { forwardRef } from 'react';
import ReactSelect from 'react-select';
import { useColorMode } from '~/hooks';
import { Input } from './input';
import { Option } from './option';
import {
  useContainerStyle,
  useControlStyle,
  useIndicatorSeparatorStyle,
  useMenuListStyle,
  useMenuPortal,
  useMenuStyle,
  useMultiValueLabelStyle,
  useMultiValueRemoveStyle,
  useMultiValueStyle,
  useOptionStyle,
  usePlaceholderStyle,
  useRSTheme,
  useSingleValueStyle,
} from './styles';
import { isSingleValue } from './types';

import type {
  MultiValue,
  OnChangeValue,
  Props as ReactSelectProps,
  SelectInstance,
} from 'react-select';
import type { SingleOption } from '~/types';
import type { SelectProps } from './types';

export const Select = forwardRef(
  <Opt extends SingleOption = SingleOption, IsMulti extends boolean = boolean>(
    props: SelectProps<Opt, IsMulti>,
    ref: React.Ref<SelectInstance<Opt, IsMulti>>,
  ): JSX.Element => {
    const { options, isMulti, onSelect, isError = false, components, ...rest } = props;

    const { isOpen, onOpen, onClose } = useDisclosure();

    const { colorMode } = useColorMode();

    // The field's error message, which Chakra renders (with this ID) only while the field
    // is invalid.
    const field = useFormControlContext();
    const errorMessage = isError && field?.isInvalid ? field.feedbackId : undefined;

    const defaultOnChange: ReactSelectProps<Opt, IsMulti>['onChange'] = changed => {
      if (isSingleValue<Opt>(changed)) {
        changed = [changed] as unknown as OnChangeValue<Opt, IsMulti>;
      }
      if (typeof onSelect === 'function') {
        onSelect(changed as MultiValue<Opt>);
      }
    };

    // The style hooks run here, in the component that knows the state, so they take it as
    // arguments: a context provided below would not reach them.
    const container = useContainerStyle<Opt, IsMulti>({ colorMode });
    const menu = useMenuStyle<Opt, IsMulti>({ colorMode, isOpen });
    const menuList = useMenuListStyle<Opt, IsMulti>({ colorMode, isOpen });
    const control = useControlStyle<Opt, IsMulti>({ colorMode, isError });
    const option = useOptionStyle<Opt, IsMulti>({ colorMode, isOpen });
    const singleValue = useSingleValueStyle<Opt, IsMulti>({ colorMode });
    const multiValue = useMultiValueStyle<Opt, IsMulti>({ colorMode });
    const multiValueLabel = useMultiValueLabelStyle<Opt, IsMulti>({ colorMode });
    const multiValueRemove = useMultiValueRemoveStyle<Opt, IsMulti>({ colorMode });
    const menuPortal = useMenuPortal<Opt, IsMulti>();
    const placeholder = usePlaceholderStyle<Opt, IsMulti>({ colorMode });
    const indicatorSeparator = useIndicatorSeparatorStyle<Opt, IsMulti>({ colorMode });
    const rsTheme = useRSTheme();

    return (
      <ReactSelect<Opt, IsMulti>
        onChange={defaultOnChange}
        onMenuClose={onClose}
        onMenuOpen={onOpen}
        isClearable={true}
        options={options}
        isMulti={isMulti}
        theme={rsTheme}
        components={{ Option, Input, ...components }}
        menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
        ref={ref}
        styles={{
          container,
          menu,
          option,
          control,
          menuList,
          menuPortal,
          multiValue,
          singleValue,
          placeholder,
          multiValueLabel,
          multiValueRemove,
          indicatorSeparator,
        }}
        aria-invalid={isError || undefined}
        aria-errormessage={errorMessage}
        {...rest}
      />
    );
  },
);
