import { Box, Stack, useToken } from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConfig } from '~/context';
import { Label } from '~/elements';
import { useBreakpointValue } from '~/hooks';

import type { Transition } from 'framer-motion';

const transition = { duration: 0.3, delay: 0.5 } as Transition;

export interface TagsProps {
  /** The tags show only when there is at least one location. */
  queryLocation: string[];
  /** The query type's display name. */
  queryType: string | undefined;
  queryTarget: string[];
}

/**
 * The query type and target labels above a query's results.
 */
export const Tags = (props: TagsProps): JSX.Element => {
  const { queryLocation, queryType, queryTarget } = props;
  const { web } = useConfig();

  const targetBg = useToken('colors', 'teal.600');
  const queryBg = useToken('colors', 'cyan.500');

  const animateLeft = useBreakpointValue({
    base: { opacity: 1, x: 0 },
    md: { opacity: 1, x: 0 },
    lg: { opacity: 1, x: 0 },
    xl: { opacity: 1, x: 0 },
  });

  const animateRight = useBreakpointValue({
    base: { opacity: 1, x: 0 },
    md: { opacity: 1, x: 0 },
    lg: { opacity: 1, x: 0 },
    xl: { opacity: 1, x: 0 },
  });

  const initialLeft = useBreakpointValue({
    base: { opacity: 0, x: '-100%' },
    md: { opacity: 0, x: '-100%' },
    lg: { opacity: 0, x: '-100%' },
    xl: { opacity: 0, x: '-100%' },
  });

  const initialRight = useBreakpointValue({
    base: { opacity: 0, x: '100%' },
    md: { opacity: 0, x: '100%' },
    lg: { opacity: 0, x: '100%' },
    xl: { opacity: 0, x: '100%' },
  });

  return (
    <Box
      p={0}
      my={4}
      w="100%"
      mx="auto"
      textAlign="left"
      maxW={{ base: '100%', lg: '75%', xl: '50%' }}
    >
      <Stack isInline align="center" justify="center" mt={4} flexWrap="wrap">
        <AnimatePresence>
          {queryLocation.length > 0 && (
            <>
              <motion.div
                initial={initialLeft}
                animate={animateLeft}
                exit={{ opacity: 0, x: '-100%' }}
                transition={transition}
              >
                <Label
                  bg={queryBg}
                  label={web.text.queryType}
                  fontSize={{ base: 'xs', md: 'sm' }}
                  value={queryType ?? 'None'}
                />
              </motion.div>
              <motion.div
                initial={initialRight}
                animate={animateRight}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={transition}
              >
                <Label
                  bg={targetBg}
                  value={queryTarget.join(', ')}
                  label={web.text.queryTarget}
                  fontSize={{ base: 'xs', md: 'sm' }}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </Stack>
    </Box>
  );
};
