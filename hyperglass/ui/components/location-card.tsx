import { useId, useMemo } from 'react';
import { Flex, Avatar, chakra } from '@chakra-ui/react';
import { motionChakra } from '~/elements';
import { useColorValue, useOpposingColor } from '~/hooks';

import type { SingleOption } from '~/types';
import type { LocationOption } from './query-location';

interface LocationCardProps {
  option: SingleOption;
  /** Whether the location is selected in the form state; the card has no state of its own. */
  isChecked: boolean;
  onChange(a: 'add' | 'remove', v: SingleOption): void;
  hasError: boolean;
}

const LocationCardWrapper = motionChakra('div', {
  baseStyle: {
    py: 4,
    px: 6,
    minW: 'xs',
    maxW: 'md',
    mx: 'auto',
    shadow: 'sm',
    rounded: 'lg',
    cursor: 'pointer',
    borderWidth: '1px',
    borderStyle: 'solid',
    // A ring for keyboard focus only, as Chakra's own controls draw it. The transparent
    // outline stays visible in forced-colors mode, which drops box shadows.
    _focusVisible: { outline: '2px solid transparent', outlineOffset: '2px', boxShadow: 'outline' },
  },
});

export const LocationCard = (props: LocationCardProps): JSX.Element => {
  const { option, onChange, isChecked, hasError } = props;
  const { label } = option;

  function handleChange(value: LocationOption) {
    onChange(isChecked ? 'remove' : 'add', value);
  }

  // Space and Enter toggle the card, as they do a checkbox. Space would otherwise scroll
  // the page, and a held key would toggle it on every repeat.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) {
        handleChange(option);
      }
    }
  }

  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const description = (option.data?.description as string | undefined) ?? null;

  const bg = useColorValue('white', 'blackSolid.600');
  const imageBorder = useColorValue('gray.600', 'whiteAlpha.800');
  const fg = useOpposingColor(bg);
  const checkedBorder = useColorValue('blue.400', 'blue.300');
  const errorBorder = useColorValue('red.500', 'red.300');

  const borderColor = useMemo(
    () =>
      hasError && isChecked
        ? // Highlight red when there are no overlapping query types for the locations selected.
          errorBorder
        : isChecked && !hasError
          ? // Highlight blue when any location is selected and there is no error.
            checkedBorder
          : // Otherwise, no border.
            'transparent',

    [hasError, isChecked, checkedBorder, errorBorder],
  );
  return (
    <LocationCardWrapper
      bg={bg}
      key={label}
      whileHover={{ scale: 1.05 }}
      borderColor={borderColor}
      role="checkbox"
      tabIndex={0}
      aria-checked={isChecked}
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={handleKeyDown}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        handleChange(option);
      }}
    >
      <>
        <Flex justifyContent="space-between" alignItems="center">
          {/* Not a heading: a checkbox's content is presentational, so it would be lost. */}
          <chakra.div
            id={labelId}
            color={fg}
            fontWeight="bold"
            mt={{ base: 2, md: 0 }}
            fontSize={{ base: 'lg', md: 'xl' }}
          >
            {label}
          </chakra.div>
          <Avatar
            color={fg}
            name={label}
            boxSize={12}
            rounded="full"
            borderWidth={1}
            bg="whiteAlpha.300"
            borderStyle="solid"
            borderColor={imageBorder}
            src={(option.data?.avatar as string) ?? undefined}
          />
        </Flex>

        {description && (
          <chakra.p id={descriptionId} mt={2} color={fg} opacity={0.6} fontSize="sm">
            {description}
          </chakra.p>
        )}
      </>
    </LocationCardWrapper>
  );
};
