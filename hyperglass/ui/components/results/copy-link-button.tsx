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
 * Copies a link to the submitted query. When the clipboard is missing (outside a secure
 * context) or refuses the link, the link is shown in a read-only field to copy by hand.
 * The browser's own clipboard API is used rather than Chakra's `useClipboard`, whose
 * fallback opens a `window.prompt`.
 */
export const CopyLinkButton = (props: CopyLinkButtonProps): JSX.Element => {
  const { link } = props;
  const { web } = useConfig();
  const [state, setState] = useState<CopyState>('idle');
  const field = useRef<HTMLInputElement>(null);

  // Focus the field once it shows; focusing it selects the link, ready to copy by hand.
  useEffect(() => {
    if (state === 'failed') {
      field.current?.focus();
    }
  }, [state]);

  async function copy(): Promise<void> {
    try {
      // Outside a secure context there is no `navigator.clipboard`, so this throws too.
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      setState('failed');
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
            onFocus={e => e.currentTarget.select()}
          />
        </FormControl>
      )}
    </Flex>
  );
};
