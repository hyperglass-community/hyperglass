import {
  Popover,
  PopoverBody,
  PopoverArrow,
  PopoverTrigger,
  PopoverContent,
  PopoverCloseButton,
  Portal,
} from '@chakra-ui/react';
import { getAllTabbable } from '@chakra-ui/utils';
import { useColorValue } from '~/hooks';

import type { PromptProps } from './types';

/** Whether `element` is shown: neither it nor an ancestor is `display: none` or hidden. */
function isShown(element: HTMLElement): boolean {
  for (let el: HTMLElement | null = element; el !== null; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }
  return true;
}

export const DesktopPrompt = (props: PromptProps): JSX.Element => {
  const { trigger, children, ...disclosure } = props;
  const { onClose } = disclosure;
  const bg = useColorValue('white', 'gray.900');

  /**
   * The popover is rendered at the end of the page (see below), so the browser's own
   * order would take Tab from its last element to the end of the page, and Shift+Tab
   * from its first to what comes before it there. Keep the order it would have next to
   * its trigger: Tab from the last element goes to the element after the trigger, and
   * Shift+Tab from the first (or from the popover itself) to the trigger, closing the
   * popover. Focus moves before it closes, so Popover doesn't return it to the trigger.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Tab') {
      return;
    }
    const content = event.currentTarget;
    const triggerElement = document.querySelector<HTMLElement>(`[aria-controls="${content.id}"]`);
    if (triggerElement === null) {
      return;
    }
    const inside = getAllTabbable(content).filter(isShown);
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === content || active === inside[0]) {
        event.preventDefault();
        triggerElement.focus();
        onClose();
      }
      return;
    }
    if (active !== inside[inside.length - 1]) {
      return;
    }
    const page = getAllTabbable(document.body).filter(el => !content.contains(el) && isShown(el));
    const index = page.indexOf(triggerElement);
    const next = index === -1 ? undefined : page[index + 1];
    if (next !== undefined) {
      event.preventDefault();
      next.focus();
      onClose();
    }
  }

  return (
    <Popover closeOnBlur={false} {...disclosure}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      {/* Render the popover in the page's body. The trigger sits in the target field's
          input group, which is a stacking context (`isolation: isolate`): a popover
          inside it is painted under the submit button that follows it in the form. */}
      <Portal>
        <PopoverContent bg={bg} onKeyDown={handleKeyDown}>
          <PopoverArrow bg={bg} />
          <PopoverCloseButton />
          <PopoverBody p={6}>{children}</PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};
