import { Box, Button, Flex, HStack, Heading, List, Text } from '@chakra-ui/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { useQueryHistory } from '~/hooks';
import { HistoryEntryRow } from './history-entry-row';

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
  const { clear, prune, remove, open } = useQueryHistory.getState();

  const [mounted, setMounted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();
  const confirmId = useId();
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
    // The button that had focus is gone; keep focus in the list.
    headingRef.current?.focus();
  }

  return (
    <Box
      as="section"
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
            <Button
              size="sm"
              colorScheme="red"
              onClick={() => {
                setConfirming(false);
                clear();
              }}
            >
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
