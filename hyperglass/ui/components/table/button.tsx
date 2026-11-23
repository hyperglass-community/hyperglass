import { IconButton } from '@chakra-ui/react';

import type { IconButtonProps } from '@chakra-ui/react';

/** An icon-only table button. Its content is an icon, so callers must name it. */
export const TableIconButton = (props: IconButtonProps): JSX.Element => (
  <IconButton size="sm" borderWidth={1} {...props} />
);
