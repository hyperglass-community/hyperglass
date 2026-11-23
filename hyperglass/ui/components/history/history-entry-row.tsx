import { Box, Button, HStack, ListItem, Text, Tooltip } from '@chakra-ui/react';
import { useId } from 'react';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import { useColorValue, useStrf } from '~/hooks';
import { formatTimestamp } from '~/util';

import type { HistoryEntry, HistoryReuseMode } from '~/hooks';

interface HistoryEntryRowProps {
  entry: HistoryEntry;
  onOpen(id: string): void;
  /** Fill the form with the entry's query, and submit it (`rerun`) or not. */
  onReuse(entry: HistoryEntry, mode: HistoryReuseMode): void;
  onDelete(id: string): void;
}

/** An icon-only button, named by its tooltip text. */
const ActionButton = (props: {
  label: string;
  icon: string;
  onClick(): void;
  /** The entry's ID, on the Open button only, so focus can return to it. */
  openId?: string;
}): JSX.Element => {
  const { label, icon, onClick, openId } = props;
  return (
    <Tooltip hasArrow label={label} placement="top">
      <Button
        mx={1}
        size="sm"
        variant="ghost"
        colorScheme="secondary"
        aria-label={label}
        data-history-open={openId}
        onClick={onClick}
      >
        <DynamicIcon icon={{ fi: icon }} boxSize="16px" />
      </Button>
    </Tooltip>
  );
};

/**
 * One saved query in the recent queries list: what it was and when, with buttons to open
 * it, run it again, run it with a new target, and delete it.
 */
export const HistoryEntryRow = (props: HistoryEntryRowProps): JSX.Element => {
  const { entry, onOpen, onReuse, onDelete } = props;
  const { web } = useConfig();
  const strF = useStrf();
  const targetId = useId();
  const locationsId = useId();
  const muted = useColorValue('gray.600', 'gray.400');
  const { labels } = entry;

  return (
    <ListItem
      px={3}
      py={2}
      display="flex"
      flexWrap="wrap"
      alignItems="center"
      borderTopWidth="1px"
      _first={{ borderTopWidth: 0 }}
    >
      {/* On a phone, the buttons go under the text, which keeps the row's whole width. */}
      <Box flex={{ base: '1 1 100%', sm: '1 1 0' }} minW={0} mr={{ base: 0, sm: 2 }}>
        <Text fontSize="sm" overflowWrap="anywhere">
          <Text as="span" fontWeight="bold">
            {labels.type}
          </Text>{' '}
          <Text as="span" fontFamily="mono" id={targetId}>
            {labels.target}
          </Text>
        </Text>
        <Text fontSize="sm" overflowWrap="anywhere" id={locationsId}>
          {labels.locations.join(', ')}
        </Text>
        {labels.variables.length > 0 && (
          <Text fontSize="sm" overflowWrap="anywhere">
            {labels.variables.join(', ')}
          </Text>
        )}
        <Text fontSize="xs" color={muted}>
          {strF(web.text.historySavedAt, {
            time: formatTimestamp(new Date(entry.savedAt).toISOString()),
          })}
        </Text>
      </Box>
      {/* Each row has the same button names: name the buttons' group after its query's
          target and locations. */}
      <HStack
        role="group"
        aria-labelledby={`${targetId} ${locationsId}`}
        spacing={0}
        flex="0 0 auto"
        ml="auto"
      >
        <ActionButton
          label={web.text.historyOpen}
          icon="FiEye"
          openId={entry.id}
          onClick={() => onOpen(entry.id)}
        />
        <ActionButton
          label={web.text.historyRerun}
          icon="FiRepeat"
          onClick={() => onReuse(entry, 'rerun')}
        />
        <ActionButton
          label={web.text.historyNewTarget}
          icon="FiEdit"
          onClick={() => onReuse(entry, 'newTarget')}
        />
        <ActionButton
          label={web.text.historyDelete}
          icon="FiTrash2"
          onClick={() => onDelete(entry.id)}
        />
      </HStack>
    </ListItem>
  );
};
