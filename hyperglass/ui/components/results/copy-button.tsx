import { Button, Tooltip, useClipboard } from '@chakra-ui/react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';

import type { ButtonProps } from '@chakra-ui/react';

interface CopyButtonProps extends ButtonProps {
  copyValue: string;
}

export const CopyButton = (props: CopyButtonProps): JSX.Element => {
  const { copyValue, ...rest } = props;
  const { onCopy, hasCopied } = useClipboard(copyValue);
  const { web } = useConfig();
  const label = web.text.copyOutput;
  return (
    <Tooltip hasArrow label={label} placement="top">
      <Button
        mx={1}
        size="sm"
        variant="ghost"
        onClick={onCopy}
        aria-label={label}
        colorScheme="secondary"
        {...rest}
      >
        <DynamicIcon icon={{ fi: hasCopied ? 'FiCheck' : 'FiCopy' }} boxSize="16px" />
      </Button>
    </Tooltip>
  );
};
