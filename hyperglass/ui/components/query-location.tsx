import { Box, Flex, Stack, Wrap, chakra, useFormControlContext } from '@chakra-ui/react';
import { useId, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { useShallow } from 'zustand/react/shallow';
import { LocationCard, Select } from '~/components';
import { isMultiValue, isSingleValue } from '~/components/select';
import { useConfig } from '~/context';
import { useFormState } from '~/hooks';

import type { SelectOnChange } from '~/components/select';
import type { DeviceGroup, FormData, OnChangeArgs, OptionGroup, SingleOption } from '~/types';

/** Location option type alias for future extensions. */
export type LocationOption = SingleOption;

interface QueryLocationProps {
  onChange: (f: OnChangeArgs) => void;
  label: string;
}

function buildOptions(devices: DeviceGroup[]): OptionGroup<LocationOption>[] {
  return devices
    .map(group => {
      const label = group.group;
      const options = group.locations
        .map(
          loc =>
            ({
              label: loc.name,
              value: loc.id,
              group: loc.group,
              data: {
                avatar: loc.avatar,
                description: loc.description,
              },
            }) as SingleOption,
        )
        .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
      return { label: label ?? '', options };
    })
    .sort((a, b) =>
      (a.label ?? 0) < (b.label ?? 0) ? -1 : (a.label ?? 0) > (b.label ?? 0) ? 1 : 0,
    );
}

export const QueryLocation = (props: QueryLocationProps): JSX.Element => {
  const { onChange, label } = props;

  const {
    devices,
    web: { locationDisplayMode },
  } = useConfig();
  const {
    formState: { errors },
  } = useFormContext<FormData>();
  const selections = useFormState(s => s.selections);
  const setSelection = useFormState(s => s.setSelection);
  const { form, filtered } = useFormState(useShallow(({ form, filtered }) => ({ form, filtered })));
  const options = useMemo(() => buildOptions(devices), [devices]);
  const groupId = useId();
  // The form field around the cards: its visible label names their group, and its error
  // message describes it.
  const field = useFormControlContext();

  const element = useMemo(() => {
    if (locationDisplayMode === 'dropdown') {
      return 'select';
    }
    if (locationDisplayMode === 'gallery') {
      return 'cards';
    }
    const groups = options.length;
    const maxOptionsPerGroup = Math.max(...options.map(opt => opt.options.length));
    const showCards = groups < 5 && maxOptionsPerGroup < 9;
    return showCards ? 'cards' : 'select';
  }, [options, locationDisplayMode]);

  const noOverlap = useMemo(
    () => form.queryLocation.length > 1 && filtered.types.length === 0,
    [form, filtered],
  );

  /**
   * Update form and state when a card selections change.
   *
   * @param action Add or remove the option.
   * @param option Full option object.
   */
  function handleCardChange(action: 'add' | 'remove', option: SingleOption) {
    // The cards show `form.queryLocation`, so decide from it too.
    const exists = form.queryLocation.includes(option.value);
    if (action === 'add' && !exists) {
      const toAdd = [...form.queryLocation, option.value];
      const newSelections = [
        ...selections.queryLocation.filter(v => v.value !== option.value),
        option,
      ];
      setSelection('queryLocation', newSelections);
      onChange({ field: 'queryLocation', value: toAdd });
    } else if (action === 'remove' && exists) {
      const toRemove = form.queryLocation.filter(v => v !== option.value);
      setSelection(
        'queryLocation',
        selections.queryLocation.filter(v => v.value !== option.value),
      );
      onChange({ field: 'queryLocation', value: toRemove });
    }
  }

  /**
   * Update form and state when select element values change.
   *
   * @param options Final value. React-select determines if an option is being added or removed and
   * only sends back the final value.
   */
  const handleSelectChange: SelectOnChange<LocationOption> = (options): void => {
    if (isMultiValue(options)) {
      onChange({ field: 'queryLocation', value: options.map(o => o.value) });
      setSelection<LocationOption>('queryLocation', options);
    } else if (isSingleValue(options)) {
      onChange({ field: 'queryLocation', value: options.value });
      setSelection<LocationOption>('queryLocation', [options]);
    }
  };

  if (element === 'cards') {
    const cards = (group: OptionGroup<LocationOption>) =>
      group.options.map(opt => (
        <LocationCard
          key={opt.label}
          option={opt}
          onChange={handleCardChange}
          hasError={noOverlap}
          isChecked={form.queryLocation.includes(opt.value)}
        />
      ));
    // The cards are checkboxes: group them under the field's label (or `label` outside a
    // form field), invalid and described by the field's error message while it has one,
    // and each named location group under its heading.
    const isInvalid = 'queryLocation' in errors;
    const groupProps = {
      role: 'group',
      'aria-labelledby': field?.labelId,
      'aria-label': field ? undefined : label,
      'aria-invalid': isInvalid || undefined,
      'aria-describedby': isInvalid && field?.isInvalid ? field.feedbackId : undefined,
    };
    return options.length === 1 ? (
      <Wrap
        p={{ lg: 4 }}
        align="flex-start"
        shouldWrapChildren
        spacing={{ base: 4, lg: 8 }}
        justify={{ base: 'center', lg: 'center' }}
        {...groupProps}
      >
        {cards(options[0])}
      </Wrap>
    ) : (
      <Box {...groupProps}>
        {options.map((group, index) =>
          group.label ? (
            <Stack
              key={group.label}
              align="center"
              role="group"
              aria-labelledby={`${groupId}-${index}`}
            >
              <chakra.h3
                id={`${groupId}-${index}`}
                fontSize={{ base: 'sm', md: 'md' }}
                alignSelf="flex-start"
                opacity={0.5}
              >
                {group.label}
              </chakra.h3>
              {cards(group)}
            </Stack>
          ) : (
            // Locations without a group: no heading, and no group without a name.
            <Stack key="" align="center">
              {cards(group)}
            </Stack>
          ),
        )}
      </Box>
    );
  }
  if (element === 'select') {
    return (
      <Select<LocationOption, true>
        isMulti
        options={options}
        aria-label={label}
        name="queryLocation"
        closeMenuOnSelect={true}
        onChange={handleSelectChange}
        value={selections.queryLocation}
        isError={typeof errors.queryLocation !== 'undefined'}
      />
    );
  }
  return <Flex>No Locations</Flex>;
};
