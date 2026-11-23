import { Button, Tooltip } from '@chakra-ui/react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';

interface PathButtonProps {
  onOpen(): void;
}

export const PathButton = (props: PathButtonProps): JSX.Element => {
  const { onOpen } = props;
  const { web } = useConfig();
  const label = web.text.viewAsPath;
  return (
    <Tooltip hasArrow label={label} placement="top">
      <Button
        mx={1}
        size="sm"
        variant="ghost"
        onClick={onOpen}
        aria-label={label}
        colorScheme="secondary"
      >
        <DynamicIcon icon={{ bi: 'BiNetworkChart' }} boxSize="16px" />
      </Button>
    </Tooltip>
  );
};
