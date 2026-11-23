import {
  Popover,
  PopoverBody,
  PopoverArrow,
  PopoverTrigger,
  PopoverContent,
  PopoverCloseButton,
  Portal,
} from '@chakra-ui/react';
import { useColorValue } from '~/hooks';

import type { PromptProps } from './types';

export const DesktopPrompt = (props: PromptProps): JSX.Element => {
  const { trigger, children, ...disclosure } = props;
  const bg = useColorValue('white', 'gray.900');

  return (
    <Popover closeOnBlur={false} {...disclosure}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      {/* Render the popover in the page's body. The trigger sits in the target field's
          input group, which is a stacking context (`isolation: isolate`): a popover
          inside it is painted under the submit button that follows it in the form. */}
      <Portal>
        <PopoverContent bg={bg}>
          <PopoverArrow bg={bg} />
          <PopoverCloseButton />
          <PopoverBody p={6}>{children}</PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};
