import {
  Alert,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  List,
  ListItem,
  Spinner,
  Text,
} from '@chakra-ui/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import {
  deleteShare,
  shareFailureMessage,
  shareLink,
  useColorValue,
  useSavedShares,
  useSavedSharesExpiry,
  useStrf,
} from '~/hooks';
import { formatTimestamp } from '~/util';

import type { SavedShare, ShareFailure } from '~/hooks';

/** Where focus goes when the list goes away: the page's main landmark (see `Layout`). */
function focusTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main');
}

/**
 * Select all of a field's text. `setSelectionRange` rather than `select()`, which doesn't
 * select the text of a read-only field on iOS Safari.
 */
function selectAll(input: HTMLInputElement): void {
  input.setSelectionRange(0, input.value.length);
}

interface SavedShareRowProps {
  share: SavedShare;
  /** Whether another row's request is running. */
  busy: boolean;
  onCopied(): void;
  onDelete(share: SavedShare): void;
  onForget(id: string): void;
  deleting: boolean;
  failure: ShareFailure | null;
}

/** One link: what was shared, when and until when, its field, copy, and delete. */
const SavedShareRow = (props: SavedShareRowProps): JSX.Element => {
  const { share, busy, onCopied, onDelete, onForget, deleting, failure } = props;
  const { web, messages } = useConfig();
  const strF = useStrf();
  const muted = useColorValue('gray.600', 'gray.400');
  const typeId = useId();
  const targetId = useId();
  const locationId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const url = shareLink(share.id, window.location);
  const { labels } = share;

  async function handleCopy(): Promise<void> {
    try {
      // Outside a secure context there is no `navigator.clipboard`, so this throws too.
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied();
    } catch {
      // The link is in the field: select it to copy by hand. No `prompt` or `alert`.
      field.current?.focus();
      if (field.current !== null) {
        selectAll(field.current);
      }
    }
  }

  return (
    <ListItem px={3} py={2} borderTopWidth="1px" _first={{ borderTopWidth: 0 }}>
      <Text fontSize="sm" overflowWrap="anywhere">
        <Text as="span" fontWeight="bold" id={typeId}>
          {labels.type}
        </Text>{' '}
        <Text as="span" fontFamily="mono" id={targetId}>
          {labels.target}
        </Text>
      </Text>
      <Text fontSize="sm" overflowWrap="anywhere" id={locationId}>
        {labels.location}
      </Text>
      <Text fontSize="xs" color={muted}>
        {strF(web.text.shareResultTime, { time: formatTimestamp(share.timestamp) })}
      </Text>
      <Text fontSize="xs" color={muted}>
        {strF(web.text.shareExpires, { time: formatTimestamp(share.expiresAt) })}
      </Text>
      {/* Each row has the same names: name its field and buttons after its query type,
          target and location. */}
      <Flex
        role="group"
        aria-labelledby={`${typeId} ${targetId} ${locationId}`}
        direction="column"
        gap={2}
        mt={2}
      >
        <Flex
          direction={{ base: 'column', sm: 'row' }}
          align={{ base: 'stretch', sm: 'flex-end' }}
          gap={2}
        >
          <FormControl flex="1 1 auto" minW={0}>
            <FormLabel fontSize="xs" mb={1}>
              {web.text.shareLink}
            </FormLabel>
            <Input
              ref={field}
              size="sm"
              isReadOnly
              value={url}
              fontFamily="mono"
              onFocus={e => selectAll(e.currentTarget)}
            />
          </FormControl>
          <HStack spacing={2} flex="0 0 auto" flexWrap="wrap">
            <Button
              size="sm"
              colorScheme="primary"
              onClick={handleCopy}
              leftIcon={<DynamicIcon icon={{ fi: copied ? 'FiCheck' : 'FiLink' }} boxSize="16px" />}
            >
              {web.text.copyLink}
            </Button>
            {/* Which row was copied; the list's status region announces it. */}
            {copied && (
              <Text fontSize="sm" aria-hidden="true">
                {web.text.linkCopied}
              </Text>
            )}
            {share.deleteToken !== null ? (
              <Button
                size="sm"
                variant="outline"
                colorScheme="red"
                onClick={() => onDelete(share)}
                // Not `isLoading`: its spinner has a fixed English label and hides the
                // button's name. Not `isDisabled`, which would drop the focus.
                aria-disabled={busy}
                aria-busy={deleting}
                leftIcon={deleting ? <Spinner size="xs" aria-hidden="true" label="" /> : undefined}
              >
                {web.text.shareDelete}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onForget(share.id)}>
                {web.text.sharesForget}
              </Button>
            )}
          </HStack>
        </Flex>
        {/* Always rendered, under the field and buttons, so the note is announced when the
            token is dropped. */}
        <Box aria-live="polite" fontSize="sm">
          {share.deleteToken === null && <Text>{web.text.shareDeleteRotated}</Text>}
        </Box>
      </Flex>
      {failure !== null && (
        <Alert status="warning" rounded="md" fontSize="sm" mt={2}>
          {shareFailureMessage(failure, messages)}
        </Alert>
      )}
    </ListItem>
  );
};

/**
 * "Your shared links": the share links created in this browser (#562), from live results
 * or saved queries, to copy or delete later, whether query history is on or not. Each
 * delete token is sent only in the header of its delete request. Forget all forgets the
 * tokens after a confirmation; the links keep working until they expire.
 *
 * The links are in this browser's storage only: render this from the client only
 * (`next/dynamic` with `ssr: false`); it also renders nothing until mounted. With sharing
 * off, the links can't be deleted any more, so they are forgotten.
 */
export const SavedShares = (): JSX.Element | null => {
  const { web, messages, share: config, requestTimeout } = useConfig();
  const links = useSavedShares(s => s.links);
  const { clear, dropToken, remove } = useSavedShares.getState();
  useSavedSharesExpiry();

  const [mounted, setMounted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; failure: ShareFailure } | null>(null);
  const [announcement, setAnnouncement] = useState<'copied' | 'deleted' | null>(null);
  const headingId = useId();
  const confirmId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  // Where focus goes once the confirmation closes.
  const refocus = useRef(false);

  useEffect(() => {
    setMounted(true);
    // Don't keep tokens that can no longer delete anything, or links the visitor can't see.
    if (!config.enable && useSavedShares.getState().links.length > 0) {
      clear();
    }
  }, [config.enable, clear]);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      clearRef.current?.focus();
    }
  }, [confirming]);

  if (!mounted || !config.enable) {
    return null;
  }

  /** The button that had focus is gone: keep focus in the list, or on the page. */
  function refocusAfterRemoval(): void {
    if (useSavedShares.getState().links.length > 0) {
      headingRef.current?.focus();
    } else {
      focusTarget()?.focus({ preventScroll: true });
    }
  }

  async function handleDelete(share: SavedShare): Promise<void> {
    if (share.deleteToken === null || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(share.id);
    setFailure(null);
    setAnnouncement(null);
    const outcome = await deleteShare(
      { id: share.id, deleteToken: share.deleteToken },
      requestTimeout * 1000,
    );
    inFlight.current = false;
    setBusy(null);
    switch (outcome.status) {
      case 'deleted':
        remove(share.id);
        setAnnouncement('deleted');
        refocusAfterRemoval();
        return;
      case 'rotated':
        // Still there, with a token this browser doesn't have: keep the link, drop the token.
        dropToken(share.id);
        return;
      case 'notFound':
        remove(share.id);
        setFailure({ id: share.id, failure: 'notFound' });
        refocusAfterRemoval();
        return;
      default:
        setFailure({ id: share.id, failure: outcome.status });
    }
  }

  function handleForget(id: string): void {
    remove(id);
    refocusAfterRemoval();
  }

  function cancel(): void {
    refocus.current = true;
    setConfirming(false);
  }

  function handleClear(): void {
    setConfirming(false);
    clear();
    // The list is gone. Don't scroll the page to the top, away from where it was.
    focusTarget()?.focus({ preventScroll: true });
  }

  // A link already gone has no row left to show its message under.
  const gone = failure !== null && !links.some(l => l.id === failure.id) ? failure : null;

  return (
    <>
      {links.length > 0 && (
        <Box
          as="section"
          aria-labelledby={headingId}
          w="100%"
          mx="auto"
          mt={4}
          textAlign="left"
          maxW={{ base: '100%', lg: '75%' }}
        >
          <Flex align="center" justify="space-between" flexWrap="wrap" mb={2}>
            <Heading as="h2" size="sm" id={headingId} ref={headingRef} tabIndex={-1}>
              {web.text.sharesTitle}
            </Heading>
            {!confirming && (
              <Button ref={clearRef} size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                {web.text.sharesClearAll}
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
                {web.text.sharesClearConfirm}
              </Text>
              <HStack>
                <Button size="sm" colorScheme="red" onClick={handleClear}>
                  {web.text.sharesClearAll}
                </Button>
                <Button ref={cancelRef} size="sm" onClick={cancel}>
                  {web.text.sharesClearCancel}
                </Button>
              </HStack>
            </Flex>
          )}
          <List borderWidth="1px" rounded="lg">
            {links.map(share => (
              <SavedShareRow
                key={share.id}
                share={share}
                busy={busy !== null}
                deleting={busy === share.id}
                failure={failure?.id === share.id ? failure.failure : null}
                onCopied={() => setAnnouncement('copied')}
                onDelete={handleDelete}
                onForget={handleForget}
              />
            ))}
          </List>
        </Box>
      )}
      {/* Kept while the list is on, also once its last link has gone, so what happened
          to that link is still shown and announced. */}
      <Box w="100%" mx="auto" mb={4} textAlign="left" maxW={{ base: '100%', lg: '75%' }}>
        {gone !== null && (
          <Alert status="warning" rounded="md" fontSize="sm" mt={2}>
            {shareFailureMessage(gone.failure, messages)}
          </Alert>
        )}
        <Text role="status" aria-atomic="true" fontSize="sm" mt={1}>
          {announcement === 'copied'
            ? web.text.linkCopied
            : announcement === 'deleted'
              ? web.text.shareDeleted
              : ''}
        </Text>
      </Box>
    </>
  );
};
