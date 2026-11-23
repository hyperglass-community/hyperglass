import {
  Alert,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  Select,
  Spinner,
  Text,
  Tooltip,
  useDisclosure,
} from '@chakra-ui/react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import {
  createShare,
  deleteShare,
  isLiveShare,
  keepForLabel,
  shareFailureMessage,
  shareKey,
  shareLink,
  useColorValue,
  useShareLinks,
  useStrf,
} from '~/hooks';
import { formatTimestamp } from '~/util';

import type { ButtonProps } from '@chakra-ui/react';
import type { CreatedShare, ShareFailure } from '~/hooks';

export interface ShareButtonProps {
  /** The `id` of the query response whose cached result is shared. */
  queryId: string;
  /**
   * The link already created for this result in this browser, or `null`. The live
   * results keep it in memory (`ResultShareButton`); a saved history entry can pass the
   * one stored with it.
   */
  share: CreatedShare | null;
  /** Called with a created link, and with `null` once it is deleted, gone or expired. */
  onChange(share: CreatedShare | null): void;
  isDisabled?: boolean;
}

/** What the popover's live region announces. */
type Announcement = 'copied' | 'deleted' | null;

/** The longest delay `setTimeout` takes; a longer one fires at once. */
const MAX_DELAY = 2 ** 31 - 1;

/**
 * Select all of a field's text. `setSelectionRange` rather than `select()`, which doesn't
 * select the text of a read-only field on iOS Safari.
 */
function selectAll(input: HTMLInputElement): void {
  input.setSelectionRange(0, input.value.length);
}

/**
 * The icon button that opens the popover. A component of its own so the tooltip and the
 * popover can both attach to the one `<button>`: the tooltip passes its handlers and ref
 * here, and `PopoverTrigger` merges its own into them.
 */
const _ShareTrigger: React.ForwardRefRenderFunction<HTMLButtonElement, ButtonProps> = (
  props: ButtonProps,
  ref,
) => (
  <PopoverTrigger>
    <Button
      ref={ref}
      mx={{ base: 0, sm: 1 }}
      size="sm"
      zIndex="1"
      variant="ghost"
      colorScheme="secondary"
      {...props}
    >
      <DynamicIcon icon={{ fi: 'FiShare2' }} boxSize="16px" />
    </Button>
  </PopoverTrigger>
);

const ShareTrigger = forwardRef<HTMLButtonElement, ButtonProps>(_ShareTrigger);

/**
 * A result's Share button. It opens a popover that creates a link to the result, kept for
 * one of `share.timeout_choices`; then shows the link to copy, its expiry and a notice that
 * anyone with it can see the result, and deletes it with its delete token. The token is
 * only ever sent in the delete request's header: it is never shown, logged or put in the
 * link or the address.
 */
export const ShareButton = (props: ShareButtonProps): JSX.Element => {
  const { queryId, share, onChange, isDisabled } = props;
  const { share: config, web, messages, requestTimeout } = useConfig();
  const strF = useStrf();
  const muted = useColorValue('gray.600', 'gray.400');
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [expiresIn, setExpiresIn] = useState(config.timeout);
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);
  const [failure, setFailure] = useState<ShareFailure | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  // Set by a create or delete to move focus to what replaced the button pressed.
  const [focusNext, setFocusNext] = useState<'link' | 'keepFor' | null>(null);
  const keepForRef = useRef<HTMLSelectElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  // Guards against a second request from a press made before the re-render disables.
  const inFlight = useRef(false);

  const live = share !== null && isLiveShare(share) ? share : null;
  const link = live === null ? '' : shareLink(live.id, window.location);

  // Forget the link when it expires: at once if it already has, else at its expiry (when
  // that is within `setTimeout`'s range; a later one is caught on the next render).
  useEffect(() => {
    if (share === null) {
      return undefined;
    }
    const left = Date.parse(share.expiresAt) - Date.now();
    if (left <= 0) {
      onChange(null);
      return undefined;
    }
    if (left > MAX_DELAY) {
      return undefined;
    }
    const timer = setTimeout(() => onChange(null), left);
    return () => clearTimeout(timer);
  }, [share, onChange]);

  useEffect(() => {
    if (focusNext === 'link') {
      linkRef.current?.focus();
    } else if (focusNext === 'keepFor') {
      keepForRef.current?.focus();
    }
  }, [focusNext]);

  function handleClose(): void {
    setFailure(null);
    setAnnouncement(null);
    setFocusNext(null);
    onClose();
  }

  async function handleCreate(): Promise<void> {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy('create');
    setFailure(null);
    setAnnouncement(null);
    const outcome = await createShare(queryId, expiresIn, requestTimeout * 1000);
    inFlight.current = false;
    setBusy(null);
    if (outcome.status === 'created') {
      onChange(outcome.share);
      setFocusNext('link');
    } else {
      setFailure(outcome.status);
    }
  }

  async function handleDelete(): Promise<void> {
    if (live === null || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy('delete');
    setFailure(null);
    setAnnouncement(null);
    const outcome = await deleteShare(live, requestTimeout * 1000);
    inFlight.current = false;
    setBusy(null);
    if (outcome.status === 'deleted') {
      onChange(null);
      setAnnouncement('deleted');
      setFocusNext('keepFor');
      return;
    }
    if (outcome.status === 'notFound') {
      // Expired, deleted elsewhere, or its token replaced by sharing the result again
      // from another browser: this token can no longer delete it.
      onChange(null);
      setFocusNext('keepFor');
    }
    setFailure(outcome.status);
  }

  async function handleCopy(): Promise<void> {
    setAnnouncement(null);
    try {
      // Outside a secure context there is no `navigator.clipboard`, so this throws too.
      await navigator.clipboard.writeText(link);
      setAnnouncement('copied');
    } catch {
      // The link is in the field: select it to copy by hand. No `prompt` or `alert`.
      setFocusNext(null);
      linkRef.current?.focus();
      if (linkRef.current !== null) {
        selectAll(linkRef.current);
      }
    }
  }

  const label = web.text.shareResult;

  return (
    <Popover
      isLazy
      isOpen={isOpen}
      onOpen={onOpen}
      onClose={handleClose}
      placement="bottom-end"
      initialFocusRef={live === null ? keepForRef : linkRef}
    >
      <Tooltip hasArrow label={label} placement="top">
        <ShareTrigger aria-label={label} isDisabled={isDisabled} />
      </Tooltip>
      {/* In a portal: the results box clips its overflow. */}
      <Portal>
        <PopoverContent w="sm" maxW="calc(100vw - 2rem)">
          <PopoverArrow />
          <PopoverHeader fontWeight="semibold">{label}</PopoverHeader>
          <PopoverBody>
            <Flex direction="column" gap={3}>
              {live === null ? (
                <>
                  <FormControl>
                    <FormLabel fontSize="sm">{web.text.shareKeepFor}</FormLabel>
                    <Select
                      ref={keepForRef}
                      size="sm"
                      value={expiresIn}
                      onChange={e => {
                        setExpiresIn(Number(e.target.value));
                        setFailure(null);
                      }}
                    >
                      {config.timeoutChoices.map(seconds => (
                        <option key={seconds} value={seconds}>
                          {keepForLabel(seconds, web.text)}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    size="sm"
                    colorScheme="primary"
                    onClick={handleCreate}
                    // Not `isLoading`: its spinner has a fixed English label and hides
                    // the button's name. Not `isDisabled`, which would drop the focus.
                    aria-disabled={busy !== null}
                    aria-busy={busy === 'create'}
                    leftIcon={
                      busy === 'create' ? (
                        <Spinner size="xs" aria-hidden="true" label="" />
                      ) : undefined
                    }
                  >
                    {web.text.shareCreate}
                  </Button>
                </>
              ) : (
                <>
                  <FormControl>
                    <FormLabel fontSize="sm">{web.text.shareLink}</FormLabel>
                    <Input
                      ref={linkRef}
                      size="sm"
                      isReadOnly
                      value={link}
                      fontFamily="mono"
                      onFocus={e => selectAll(e.currentTarget)}
                    />
                  </FormControl>
                  <Button
                    size="sm"
                    colorScheme="primary"
                    onClick={handleCopy}
                    leftIcon={
                      <DynamicIcon
                        icon={{ fi: announcement === 'copied' ? 'FiCheck' : 'FiLink' }}
                        boxSize="16px"
                      />
                    }
                  >
                    {web.text.copyLink}
                  </Button>
                  <Text fontSize="sm" color={muted}>
                    {strF(web.text.shareExpires, { time: formatTimestamp(live.expiresAt) })}
                  </Text>
                  <Text fontSize="sm">{web.text.shareNotice}</Text>
                  <Button
                    size="sm"
                    variant="outline"
                    colorScheme="red"
                    onClick={handleDelete}
                    // Not `isLoading`: its spinner has a fixed English label and hides
                    // the button's name. Not `isDisabled`, which would drop the focus.
                    aria-disabled={busy !== null}
                    aria-busy={busy === 'delete'}
                    leftIcon={
                      busy === 'delete' ? (
                        <Spinner size="xs" aria-hidden="true" label="" />
                      ) : undefined
                    }
                  >
                    {web.text.shareDelete}
                  </Button>
                </>
              )}
              {failure !== null && (
                <Alert status="warning" rounded="md" fontSize="sm">
                  {shareFailureMessage(failure, messages)}
                </Alert>
              )}
              {/* Always rendered, so a screen reader announces the change. */}
              <Text role="status" aria-atomic="true" fontSize="sm">
                {announcement === 'copied'
                  ? web.text.linkCopied
                  : announcement === 'deleted'
                    ? web.text.shareDeleted
                    : ''}
              </Text>
            </Flex>
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};

interface ResultShareButtonProps {
  /** The response's `id`. */
  queryId: string;
  /** The response's `timestamp`: with the id, it tells this cached result from a later one. */
  timestamp: string;
  isDisabled?: boolean;
}

/** The Share button of a live result, whose link is kept in memory for the page. */
export const ResultShareButton = (props: ResultShareButtonProps): JSX.Element => {
  const { queryId, timestamp, isDisabled } = props;
  const key = shareKey(queryId, timestamp);
  const share = useShareLinks(s => s.links[key] ?? null);
  const save = useShareLinks(s => s.save);
  const onChange = useCallback((next: CreatedShare | null) => save(key, next), [key, save]);
  return (
    <ShareButton queryId={queryId} share={share} onChange={onChange} isDisabled={isDisabled} />
  );
};
