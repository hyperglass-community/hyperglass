import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text, Tooltip, VisuallyHidden } from '@chakra-ui/react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import { useStrf } from '~/hooks';

import type { ButtonProps, TextProps } from '@chakra-ui/react';
import type { RequeryOutcome } from '~/hooks/use-lg-query';

interface RequeryButtonProps extends ButtonProps {
  /** Run on click: `useRequeryCooldown`'s `requery`. */
  requery(): unknown;
  /** What the button's live region says: `useRequeryCooldown`'s `announcement`. */
  announcement?: string;
}

export interface RequeryCooldown {
  /** Runs the query, or during the cooldown shows and announces the time left. */
  requery(): void;
  /** When the countdown being shown ends, or `null` when none is shown. */
  until: number | null;
  /** What the live region says; set once per press and cleared a few seconds later. */
  announcement: string;
}

/** How long after a press the live region gets its text, after being cleared. */
const ANNOUNCE_DELAY = 100;
/**
 * How long the live region keeps its text. Long enough for a screen reader to read a
 * queued polite announcement (VoiceOver can drop one whose node is emptied first), short
 * enough that a user browsing later doesn't find a stale figure. It is also cleared when
 * the cooldown ends.
 */
const ANNOUNCE_FOR = 5000;

/**
 * The requery button's cooldown. A press before `refreshAt` doesn't call `requery`: it
 * starts a countdown to `refreshAt` and announces the time left once. A press answered
 * from the server's cache with a cooldown still running, as when another visitor's forced
 * run started it, does the same with the response's cooldown.
 *
 * The countdown's ticks are rendered by `RequeryCountdown`, not here, so a tick doesn't
 * re-render the component using this hook (and the result under it).
 *
 * @param requery Runs the query again (`useLGQuery`'s `requery`).
 * @param refreshAt When a forced refresh would run, in milliseconds since the epoch, or
 * `null` when there is no cooldown (refresh disabled, or not known).
 */
export function useRequeryCooldown(
  requery: () => Promise<RequeryOutcome>,
  refreshAt: number | null,
): RequeryCooldown {
  const { web } = useConfig();
  const strF = useStrf();

  const [until, setUntil] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const cancelAnnouncement = useCallback((): void => {
    if (announceTimer.current !== null) {
      clearTimeout(announceTimer.current);
      announceTimer.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnnouncement();
    };
  }, [cancelAnnouncement]);

  // End the cooldown when its time is up: one render, not one per second.
  useEffect(() => {
    if (until === null) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        setUntil(null);
        cancelAnnouncement();
        setAnnouncement('');
      },
      Math.max(0, until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [until, cancelAnnouncement]);

  const startCountdown = useCallback(
    (end: number): void => {
      setUntil(end);
      // Cleared first and set a moment later, so a screen reader reads a second press
      // that gives the same text. Ticks don't change it: it is read once per press.
      const text = strF(web.text.refreshCooldown, {
        seconds: Math.ceil((end - Date.now()) / 1000),
      });
      cancelAnnouncement();
      setAnnouncement('');
      announceTimer.current = setTimeout(() => {
        setAnnouncement(text);
        announceTimer.current = setTimeout(() => {
          announceTimer.current = null;
          setAnnouncement('');
        }, ANNOUNCE_FOR);
      }, ANNOUNCE_DELAY);
    },
    [cancelAnnouncement, strF, web.text.refreshCooldown],
  );

  const onRequery = (): void => {
    if (refreshAt !== null && refreshAt > Date.now()) {
      startCountdown(refreshAt);
      return;
    }
    void requery().then(outcome => {
      // An answer from the cache whose cooldown has already ended starts a countdown that
      // ends at once, before anything is shown or announced.
      if (mounted.current && outcome.cached && outcome.refreshAt !== null) {
        startCountdown(outcome.refreshAt);
      }
    });
  };

  return { requery: onRequery, until, announcement };
}

const _RequeryButton: React.ForwardRefRenderFunction<HTMLButtonElement, RequeryButtonProps> = (
  props: RequeryButtonProps,
  ref,
) => {
  const { requery, announcement = '', ...rest } = props;
  const { web } = useConfig();
  const label = web.text.reloadQuery;

  return (
    <>
      <Tooltip hasArrow label={label} placement="top">
        <Button
          mx={{ base: 0, sm: 1 }}
          ref={ref}
          size="sm"
          zIndex="1"
          variant="ghost"
          onClick={() => void requery()}
          aria-label={label}
          colorScheme="secondary"
          {...rest}
        >
          <DynamicIcon icon={{ fi: 'FiRepeat' }} boxSize="16px" />
        </Button>
      </Tooltip>
      {/* Present while empty too: a live region added together with its text is often not
      announced. Visually hidden and out of the flow, so it takes no space in the row. */}
      <VisuallyHidden role="status" aria-live="polite">
        {announcement}
      </VisuallyHidden>
    </>
  );
};

export const RequeryButton = forwardRef<HTMLButtonElement, RequeryButtonProps>(_RequeryButton);

interface RequeryCountdownProps extends TextProps {
  /** When the cooldown ends, in milliseconds since the epoch: `useRequeryCooldown`'s `until`. */
  until: number;
}

/**
 * The visible countdown of `useRequeryCooldown`, updated on each whole second of the time
 * left and empty at zero. Render it with `key={until}`, so a new cooldown starts from the
 * current time. Screen readers get the time left from the button's live region instead,
 * once per press, so this is hidden from them.
 */
export const RequeryCountdown = (props: RequeryCountdownProps): JSX.Element | null => {
  const { until, ...rest } = props;
  const { web } = useConfig();
  const strF = useStrf();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const left = until - Date.now();
    if (left <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setNow(Date.now()), left % 1000 || 1000);
    return () => clearTimeout(timer);
  }, [until, now]);

  const seconds = Math.ceil((until - now) / 1000);
  if (seconds <= 0) {
    return null;
  }
  return (
    <Text aria-hidden="true" fontSize="xs" {...rest}>
      {strF(web.text.refreshCooldown, { seconds })}
    </Text>
  );
};
