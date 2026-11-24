import { Select } from '@chakra-ui/react';
import { useConfig } from '~/context';
import { useStrf } from '~/hooks';

import type { SelectProps } from '@chakra-ui/react';

export const PageSelect = (props: SelectProps): JSX.Element => {
  const { web } = useConfig();
  const strF = useStrf();
  return (
    <Select size="sm" aria-label={web.text.pageSize} {...props}>
      {[5, 10, 20, 30, 40, 50].map(count => (
        <option key={count} value={count}>
          {strF(web.text.pageSizeOption, { count })}
        </option>
      ))}
    </Select>
  );
};
