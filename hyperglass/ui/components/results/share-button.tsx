import {
  Alert,
  Box,
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
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import {
  createShare,
  deleteShare,
  isLiveLink,
  keepForLabel,
  shareFailureMessage,
  shareLink,
  useColorValue,
  useShareLinks,
  useStrf,
} from '~/hooks';
import { formatTimestamp } from '~/util';

import type { ButtonProps } from '@chakra-ui/react';
import type { ShareFailure, ShareLink } from '~/hooks';

export interface ShareButtonProps {
  /** The `id` of the query response whose cached result is shared. */
  queryId: string;
  /** The `timestamp` of the result shown: links of other results are earlier ones. */
  timestamp: string;
  /**
   * The links created for this query in this browser, for this result and earlier ones.
   * The live results keep them in memory (`ResultShareButton`); a saved history entry can
   * pass those stored with it.
   */
  links: ShareLink[];
  /** Keep a created link, or replace the one with its id (its token dropped). */
  onAdd(link: ShareLink): void;
  /** Forget a link: deleted, gone, or expired. */
  onRemove(id: string): void;
  isDisabled?: boolean;
}

/** What the popover's live region announces. */
type Announcement = 'copied' | 'deleted' | 'expired' | null;

/** Where focus goes after the change an action makes. */
type FocusNext = { link: string } | 'auto' | null;

/**
 * Milliseconds after the popover closes within which the button getting focus is the
 * popover returning it (Chakra does so on the next frame), not the visitor.
 */
const FOCUS_RETURN = 100;

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

interface LinkViewProps {
  link: ShareLink;
  label: string;
  /** Registers the link's field, to focus it. */
  fieldRef(element: HTMLInputElement | null): void;
  busy: boolean;
  disabled: boolean;
  onCopied(): void;
  onDelete(): void;
}

/** One link: its field, copy, expiry, and delete while this page has its token. */
const LinkView = (props: LinkViewProps): JSX.Element => {
  const { link, label, fieldRef, busy, disabled, onCopied, onDelete } = props;
  const { web } = useConfig();
  const strF = useStrf();
  const muted = useColorValue('gray.600', 'gray.400');
  const field = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const url = shareLink(link.id, window.location);
  const labelId = useId();

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
    // A group named by the link's label, so its Copy and Delete buttons are told apart
    // from those of another link.
    <Flex role="group" aria-labelledby={labelId} direction="column" gap={2}>
      <FormControl>
        <FormLabel id={labelId} fontSize="sm">
          {label}
        </FormLabel>
        <Input
          ref={element => {
            field.current = element;
            fieldRef(element);
          }}
          size="sm"
          isReadOnly
          value={url}
          fontFamily="mono"
          onFocus={e => selectAll(e.currentTarget)}
        />
      </FormControl>
      <Button
        size="sm"
        colorScheme="primary"
        onClick={handleCopy}
        leftIcon={<DynamicIcon icon={{ fi: copied ? 'FiCheck' : 'FiLink' }} boxSize="16px" />}
      >
        {web.text.copyLink}
      </Button>
      <Text fontSize="sm" color={muted}>
        {strF(web.text.shareExpires, { time: formatTimestamp(link.expiresAt) })}
      </Text>
      {/* Always rendered, so the note is announced when the token is dropped. */}
      <Box aria-live="polite" fontSize="sm">
        {link.deleteToken === null && <Text>{web.text.shareDeleteRotated}</Text>}
      </Box>
      {link.deleteToken !== null && (
        <Button
          size="sm"
          variant="outline"
          colorScheme="red"
          onClick={onDelete}
          // Not `isLoading`: its spinner has a fixed English label and hides the button's
          // name. Not `isDisabled`, which would drop the focus.
          aria-disabled={disabled}
          aria-busy={busy}
          leftIcon={busy ? <Spinner size="xs" aria-hidden="true" label="" /> : undefined}
        >
          {web.text.shareDelete}
        </Button>
      )}
    </Flex>
  );
};

/**
 * A result's Share button. It opens a popover that creates a link to the result, kept for
 * one of `share.timeout_choices`; then shows the link to copy, its expiry and a notice that
 * anyone with it can see the result, and deletes it with its delete token. Links created
 * for earlier results of the same query (before it ran again) are listed too. A token is
 * only ever sent in the delete request's header: it is never shown, logged or put in a
 * link or the address.
 */
export const ShareButton = (props: ShareButtonProps): JSX.Element => {
  const { queryId, timestamp, links, onAdd, onRemove, isDisabled } = props;
  const { share: config, web, messages, requestTimeout } = useConfig();
  const strF = useStrf();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [expiresIn, setExpiresIn] = useState(config.timeout);
  const [busy, setBusy] = useState<'create' | string | null>(null);
  const [failure, setFailure] = useState<ShareFailure | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  const [focusNext, setFocusNext] = useState<FocusNext>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const keepForRef = useRef<HTMLSelectElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const currentFieldRef = useRef<HTMLInputElement | null>(null);
  const fields = useRef(new Map<string, HTMLInputElement>());
  // Guards against a second request from a press made before the re-render disables.
  const inFlight = useRef(false);
  // The result shown now, for a create that resolves after the query ran again.
  const latest = useRef(timestamp);
  latest.current = timestamp;
  // When the popover last closed: focus coming back to the button right after doesn't
  // open its tooltip over the page. Only right after: a close that sent focus elsewhere
  // leaves nothing that would swallow a later focus or hover.
  const closedAt = useRef<number | null>(null);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const live = links.filter(l => isLiveLink(l));
  const current = [...live].reverse().find(l => l.timestamp === timestamp) ?? null;
  const earlier = live.filter(l => l !== current).reverse();

  // Forget links when they expire: at once those that have, the next one at its deadline
  // (when that is within `setTimeout`'s range; a later one is caught on a later render).
  useEffect(() => {
    const now = Date.now();
    const expired = links.filter(l => !isLiveLink(l, now));
    if (expired.length > 0) {
      for (const link of expired) {
        onRemove(link.id);
      }
      if (openRef.current) {
        setAnnouncement('expired');
        setFocusNext('auto');
      }
      return undefined;
    }
    if (links.length === 0) {
      return undefined;
    }
    const next = Math.min(...links.map(l => l.deadline)) - now;
    if (next > MAX_DELAY) {
      return undefined;
    }
    const timer = setTimeout(() => {
      for (const link of links.filter(l => !isLiveLink(l))) {
        onRemove(link.id);
      }
      if (openRef.current) {
        setAnnouncement('expired');
        setFocusNext('auto');
      }
    }, next);
    return () => clearTimeout(timer);
  }, [links, onRemove]);

  // Move focus to what replaced the element an action removed, inside the popover.
  useEffect(() => {
    if (focusNext === null || !isOpen) {
      return;
    }
    if (focusNext !== 'auto') {
      fields.current.get(focusNext.link)?.focus();
      return;
    }
    const content = contentRef.current;
    if (content === null || content.contains(document.activeElement)) {
      return;
    }
    const target =
      keepForRef.current ?? currentFieldRef.current ?? content.querySelector('input') ?? content;
    target.focus();
  }, [focusNext, isOpen]);

  function handleClose(): void {
    setFailure(null);
    setAnnouncement(null);
    setFocusNext(null);
    closedAt.current = performance.now();
    onClose();
  }

  async function handleCreate(): Promise<void> {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    const forResult = timestamp;
    setBusy('create');
    setFailure(null);
    setAnnouncement(null);
    const outcome = await createShare(
      // The result shown: never a newer one the query's cache entry holds by now.
      { queryId, timestamp: forResult, expiresIn },
      { timeout: requestTimeout * 1000, maxLifetime: Math.max(...config.timeoutChoices) * 1000 },
    );
    inFlight.current = false;
    setBusy(null);
    if (outcome.status !== 'created') {
      setFailure(outcome.status);
      return;
    }
    // Filed under the result it was made from, also if the query ran again meanwhile.
    onAdd({ ...outcome.share, timestamp: forResult });
    if (forResult === latest.current) {
      setFocusNext({ link: outcome.share.id });
    }
  }

  async function handleDelete(link: ShareLink): Promise<void> {
    if (link.deleteToken === null || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(link.id);
    setFailure(null);
    setAnnouncement(null);
    const outcome = await deleteShare(
      { id: link.id, deleteToken: link.deleteToken },
      requestTimeout * 1000,
    );
    inFlight.current = false;
    setBusy(null);
    switch (outcome.status) {
      case 'deleted':
        onRemove(link.id);
        setAnnouncement('deleted');
        setFocusNext('auto');
        return;
      case 'rotated':
        // Still there, with a token this page doesn't have: keep the link, drop the token.
        onAdd({ ...link, deleteToken: null });
        setFocusNext({ link: link.id });
        return;
      case 'notFound':
        onRemove(link.id);
        setFocusNext('auto');
        setFailure('notFound');
        return;
      default:
        setFailure(outcome.status);
    }
  }

  const label = web.text.shareResult;
  const registerField = (id: string, isCurrent: boolean) => (el: HTMLInputElement | null) => {
    if (el === null) {
      fields.current.delete(id);
    } else {
      fields.current.set(id, el);
    }
    if (isCurrent) {
      currentFieldRef.current = el;
    }
  };

  return (
    <Popover
      isLazy
      isOpen={isOpen}
      onOpen={onOpen}
      onClose={handleClose}
      placement="bottom-end"
      initialFocusRef={current === null ? keepForRef : currentFieldRef}
    >
      <Tooltip
        hasArrow
        label={label}
        placement="top"
        isOpen={tooltipOpen && !isOpen}
        onOpen={() => {
          const closed = closedAt.current;
          if (closed !== null && performance.now() - closed < FOCUS_RETURN) {
            return;
          }
          setTooltipOpen(true);
        }}
        onClose={() => setTooltipOpen(false)}
      >
        <ShareTrigger
          aria-label={label}
          isDisabled={isDisabled}
          // A pointer coming over the button wants the tooltip, after a close too.
          onPointerEnter={() => {
            closedAt.current = null;
          }}
        />
      </Tooltip>
      {/* In a portal: the results box clips its overflow. */}
      <Portal>
        <PopoverContent ref={contentRef} w="sm" maxW="calc(100vw - 2rem)">
          <PopoverArrow />
          <PopoverHeader fontWeight="semibold">{label}</PopoverHeader>
          <PopoverBody>
            <Flex direction="column" gap={3}>
              {current === null ? (
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
                <LinkView
                  link={current}
                  label={web.text.shareLink}
                  fieldRef={registerField(current.id, true)}
                  busy={busy === current.id}
                  disabled={busy !== null}
                  onCopied={() => setAnnouncement('copied')}
                  onDelete={() => handleDelete(current)}
                />
              )}
              {earlier.map(link => (
                <LinkView
                  key={link.id}
                  link={link}
                  label={strF(web.text.shareEarlierLink, { time: formatTimestamp(link.timestamp) })}
                  fieldRef={registerField(link.id, false)}
                  busy={busy === link.id}
                  disabled={busy !== null}
                  onCopied={() => setAnnouncement('copied')}
                  onDelete={() => handleDelete(link)}
                />
              ))}
              {live.length > 0 && <Text fontSize="sm">{web.text.shareNotice}</Text>}
              {live.some(l => l.deleteToken !== null) && (
                <Text fontSize="sm">{web.text.shareDeleteScope}</Text>
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
                    : announcement === 'expired'
                      ? web.text.shareLinkExpired
                      : ''}
              </Text>
            </Flex>
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};

/** No links, as one constant: a new array per render would re-render forever. */
const NO_LINKS: ShareLink[] = [];

interface ResultShareButtonProps {
  /** The response's `id`. */
  queryId: string;
  /** The response's `timestamp`, which tells this result from earlier runs of the query. */
  timestamp: string;
  isDisabled?: boolean;
}

/** The Share button of a live result, whose links are kept in memory for the page. */
export const ResultShareButton = (props: ResultShareButtonProps): JSX.Element => {
  const { queryId, timestamp, isDisabled } = props;
  const links = useShareLinks(s => s.links[queryId] ?? NO_LINKS);
  const add = useShareLinks(s => s.add);
  const remove = useShareLinks(s => s.remove);
  const onAdd = useCallback((link: ShareLink) => add(queryId, link), [queryId, add]);
  const onRemove = useCallback((id: string) => remove(queryId, id), [queryId, remove]);
  return (
    <ShareButton
      queryId={queryId}
      timestamp={timestamp}
      links={links}
      onAdd={onAdd}
      onRemove={onRemove}
      isDisabled={isDisabled}
    />
  );
};
