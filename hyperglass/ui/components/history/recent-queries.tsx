import { Box, Button, Flex, HStack, Heading, List, Text } from '@chakra-ui/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { useHistoryView, useQueryHistory } from '~/hooks';
import { HistoryEntryRow } from './history-entry-row';

/** Where focus goes when the list goes away: the page's main landmark (see `Layout`). */
function focusTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main');
}

/**
 * The queries this browser saved, on the landing page: open one to see its results,
 * delete one, or delete them all after a confirmation.
 *
 * History lives in this browser's storage only, so the page's prerendered markup can't
 * have it. Render it from the client only (`next/dynamic` with `ssr: false`); it also
 * renders nothing until mounted, so a hydrating render matches the empty markup.
 */
export const RecentQueries = (): JSX.Element | null => {
  const { web } = useConfig();
  const { enable, limit } = web.history;
  const entries = useQueryHistory(s => s.entries);
  const { clear, prune, remove } = useQueryHistory.getState();
  const { open } = useHistoryView.getState();

  const [mounted, setMounted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();
  const confirmId = useId();
  const sectionRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the confirmation closes.
  const refocus = useRef(false);

  useEffect(() => {
    setMounted(true);
    // Read the store, not the render's state: the first render after hydration still has
    // the store's initial state.
    if (!enable) {
      // Don't keep a history the visitor can no longer see or delete.
      if (useQueryHistory.getState().entries.length > 0) {
        clear();
      }
      useQueryHistory.persist.clearStorage();
    } else {
      // The limit may have been lowered since the entries were saved.
      prune(limit);
    }
  }, [enable, limit, clear, prune]);

  // Back from an opened entry: return focus to its Open button, or to the list if it is
  // gone. Once the list has rendered.
  useEffect(() => {
    if (!mounted) {
      return;
    }
    const id = useHistoryView.getState().takeReturnFocus();
    if (id === null) {
      return;
    }
    const button = Array.from(
      sectionRef.current?.querySelectorAll<HTMLElement>('[data-history-open]') ?? [],
    ).find(b => b.dataset.historyOpen === id);
    (button ?? headingRef.current ?? focusTarget())?.focus();
  }, [mounted]);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      clearRef.current?.focus();
    }
  }, [confirming]);

  if (!mounted || !enable || entries.length === 0) {
    return null;
  }

  function cancel(): void {
    refocus.current = true;
    setConfirming(false);
  }

  function handleDelete(id: string): void {
    remove(id);
    // The button that had focus is gone. Keep focus in the list, or, when the list goes
    // with its last entry, on the page.
    if (useQueryHistory.getState().entries.length > 0) {
      headingRef.current?.focus();
    } else {
      focusTarget()?.focus();
    }
  }

  function handleClear(): void {
    setConfirming(false);
    clear();
    // The list is gone.
    focusTarget()?.focus();
  }

  return (
    <Box
      as="section"
      ref={sectionRef}
      aria-labelledby={headingId}
      w="100%"
      mx="auto"
      my={4}
      textAlign="left"
      maxW={{ base: '100%', lg: '75%' }}
    >
      <Flex align="center" justify="space-between" flexWrap="wrap" mb={2}>
        <Heading as="h2" size="sm" id={headingId} ref={headingRef} tabIndex={-1}>
          {web.text.historyTitle}
        </Heading>
        {!confirming && (
          <Button ref={clearRef} size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            {web.text.historyClearAll}
          </Button>
        )}
      </Flex>
      {confirming && (
        <Flex
          role="group"
          aria-labelledby={confirmId}
          align="center"
          justify="space-between"
          flexWrap="wrap"
          gap={2}
          mb={2}
          p={3}
          borderWidth="1px"
          rounded="lg"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              cancel();
            }
          }}
        >
          <Text id={confirmId} fontSize="sm">
            {web.text.historyClearConfirm}
          </Text>
          <HStack>
            <Button size="sm" colorScheme="red" onClick={handleClear}>
              {web.text.historyClearAll}
            </Button>
            <Button ref={cancelRef} size="sm" onClick={cancel}>
              {web.text.historyClearCancel}
            </Button>
          </HStack>
        </Flex>
      )}
      <List borderWidth="1px" rounded="lg">
        {entries.map(entry => (
          <HistoryEntryRow key={entry.id} entry={entry} onOpen={open} onDelete={handleDelete} />
        ))}
      </List>
    </Box>
  );
};
