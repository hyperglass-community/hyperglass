import { Box, Button, Flex, HStack, Heading, List, Text } from '@chakra-ui/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { directiveRetains, useDevice, useHistoryView, useQueryHistory } from '~/hooks';
import { HistoryEntryRow } from './history-entry-row';

/** Where focus goes when the list goes away: the page's main landmark (see `Layout`). */
function focusTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main');
}

/**
 * The queries this browser saved, on the landing page: open one to see its results, fill
 * the form with one to run it again or with a new target, delete one, or delete them all
 * after a confirmation.
 *
 * History lives in this browser's storage only, so the page's prerendered markup can't
 * have it. Render it from the client only (`next/dynamic` with `ssr: false`); it also
 * renders nothing until mounted, so a hydrating render matches the empty markup.
 */
export const RecentQueries = (): JSX.Element | null => {
  const { web } = useConfig();
  const { enable, limit } = web.history;
  const entries = useQueryHistory(s => s.entries);
  const { clear, dropUnretained, prune, remove } = useQueryHistory.getState();
  const getDevice = useDevice();
  const { open, reuse } = useHistoryView.getState();

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

  // A directive may have been set to `retain: false` since its results were saved, here or
  // by a tab still running the configuration from before (its entries arrive by `storage`
  // event). Checked on load and whenever the entries change; it writes only when something
  // is dropped. Keep the results of a location or query type no longer configured: nothing
  // says they may not be kept, and the visitor can still see and delete them.
  useEffect(() => {
    if (!enable || entries.length === 0) {
      return;
    }
    dropUnretained((query, deviceId) => {
      const device = getDevice(deviceId);
      return device === null || directiveRetains(device, query) !== false;
    });
  }, [enable, entries, dropUnretained, getDevice]);

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
      focusTarget()?.focus({ preventScroll: true });
    }
  }

  function handleClear(): void {
    setConfirming(false);
    clear();
    // The list is gone. Don't scroll the page to the top, away from where it was.
    focusTarget()?.focus({ preventScroll: true });
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
          <HistoryEntryRow
            key={entry.id}
            entry={entry}
            onOpen={open}
            onReuse={reuse}
            onDelete={handleDelete}
          />
        ))}
      </List>
    </Box>
  );
};
