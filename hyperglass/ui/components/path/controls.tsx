import { ButtonGroup, IconButton } from '@chakra-ui/react';
import { useReactFlow } from 'reactflow';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';

export const Controls = (): JSX.Element => {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { web } = useConfig();
  return (
    <ButtonGroup
      m={4}
      size="sm"
      right={0}
      zIndex={4}
      bottom={0}
      isAttached
      pos="absolute"
      variant="solid"
      colorScheme="secondary"
    >
      <IconButton
        icon={<DynamicIcon icon={{ fi: 'FiPlus' }} />}
        onClick={() => zoomIn()}
        aria-label={web.text.zoomIn}
      />
      <IconButton
        icon={<DynamicIcon icon={{ fi: 'FiMinus' }} />}
        onClick={() => zoomOut()}
        aria-label={web.text.zoomOut}
      />
      <IconButton
        icon={<DynamicIcon icon={{ fi: 'FiSquare' }} />}
        onClick={() => fitView()}
        aria-label={web.text.fitNodes}
      />
    </ButtonGroup>
  );
};
