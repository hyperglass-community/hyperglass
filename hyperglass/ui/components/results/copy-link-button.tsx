import { Button, Flex, FormControl, FormLabel, Input, Text, Tooltip } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';

interface CopyLinkButtonProps {
  /** The link to copy. */
  link: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Select all of a field's text. `setSelectionRange` rather than `select()`, which doesn't
 * select the text of a read-only field on iOS Safari.
 */
function selectAll(input: HTMLInputElement): void {
  input.setSelectionRange(0, input.value.length);
}

/**
 * Copies a link to the submitted query. When the clipboard is missing (outside a secure
 * context) or refuses the link, the link is shown in a read-only field to copy by hand.
 * The browser's own clipboard API is used rather than Chakra's `useClipboard`, whose
 * fallback opens a `window.prompt`.
 */
export const CopyLinkButton = (props: CopyLinkButtonProps): JSX.Element => {
  const { link } = props;
  const { web } = useConfig();
  const [state, setState] = useState<CopyState>('idle');
  // Failed copies so far: each one focuses the field again, also when it already shows
  // from an earlier failure. Focusing it selects the link (`onFocus`).
  const [failures, setFailures] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (failures > 0 && field.current !== null) {
      field.current.focus();
    }
  }, [failures]);

  async function copy(): Promise<void> {
    try {
      // Outside a secure context there is no `navigator.clipboard`, so this throws too.
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      setState('failed');
      setFailures(n => n + 1);
    }
  }

  const label = web.text.copyLink;

  return (
    <Flex w="100%" direction="column" alignItems="flex-end" gap={2}>
      <Flex alignItems="center" gap={2}>
        {/* A live region that is always there, so a screen reader announces the change. */}
        <Text role="status" fontSize="sm" aria-atomic="true">
          {state === 'copied' ? web.text.linkCopied : ''}
        </Text>
        <Tooltip hasArrow label={label} placement="top">
          <Button
            size="sm"
            variant="ghost"
            onClick={copy}
            aria-label={label}
            colorScheme="secondary"
          >
            <DynamicIcon icon={{ fi: state === 'copied' ? 'FiCheck' : 'FiLink' }} boxSize="16px" />
          </Button>
        </Tooltip>
      </Flex>
      {state === 'failed' && (
        <FormControl>
          <FormLabel fontSize="sm">{web.text.queryLink}</FormLabel>
          <Input
            ref={field}
            size="sm"
            isReadOnly
            value={link}
            fontFamily="mono"
            onFocus={e => selectAll(e.currentTarget)}
          />
        </FormControl>
      )}
    </Flex>
  );
};
