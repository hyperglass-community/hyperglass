import { Button, Flex, Text } from '@chakra-ui/react';
import { useEffect, useMemo, useRef } from 'react';
import { Path, ResultPanel, ResultsView, Tags } from '~/components';
import { CopyButton } from '~/components/results/copy-button';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import { useColorValue, useHistoryView, useQueryHistory, useStrf } from '~/hooks';
import { formatTimestamp } from '~/util';

import type { ResultQueryState } from '~/components';
import type { HistoryResult } from '~/hooks';

interface StoredResultProps {
  index: number;
  deviceId: string;
  result: HistoryResult;
  queryTarget: string[];
  displayTarget: string;
}

/** One saved response, read-only: no request, no polling, no requery. */
const StoredResult = (props: StoredResultProps): JSX.Element => {
  const { index, deviceId, result, queryTarget, displayTarget } = props;
  // Not shown as a cached response: the page shows when it was saved instead.
  const query = useMemo<ResultQueryState>(
    () => ({
      data: { ...result.data, cached: false },
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchedAfterMount: true,
    }),
    [result.data],
  );
  return (
    <ResultPanel
      index={index}
      location={{ id: deviceId, name: result.name }}
      queryTarget={queryTarget}
      query={query}
      errorLevel="success"
      buttons={({ copyValue, showPath }) => (
        <>
          {/* Without `onEnriched`, the AS path makes no request. */}
          {showPath && <Path response={result.data} displayTarget={displayTarget} />}
          <CopyButton copyValue={copyValue} />
        </>
      )}
    />
  );
};

/**
 * Close the opened entry. When `Layout` gave it a browser history entry, leave that entry
 * instead, so Back and Forward stay in step with the view; its popstate closes it.
 */
function leave(close: () => void): void {
  if (window.history.state?.ultraglass === 'history') {
    window.history.back();
  } else {
    close();
  }
}

/**
 * The saved query that is open, shown read-only in place of the form, with a button that
 * closes it. The browser's Back button closes it too (see `Layout`).
 */
export const HistoryResults = (): JSX.Element | null => {
  const { web } = useConfig();
  const strF = useStrf();
  const muted = useColorValue('gray.600', 'gray.400');
  const openId = useHistoryView(s => s.openId);
  const close = useHistoryView(s => s.close);
  const entry = useQueryHistory(s => s.entries.find(e => e.id === openId));
  const backRef = useRef<HTMLButtonElement>(null);

  // Move focus to the view that replaced the list.
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  // The entry was deleted, in another tab: return to the list, through the browser history
  // entry `Layout` added for it, as Back does.
  const missing = entry === undefined;
  useEffect(() => {
    if (missing) {
      leave(close);
    }
  }, [missing, close]);

  if (entry === undefined) {
    return null;
  }

  function handleBack(): void {
    leave(close);
  }

  const { query, labels, results } = entry;
  // In the order the locations were queried.
  const deviceIds = [
    ...query.queryLocation.filter(id => id in results),
    ...Object.keys(results).filter(id => !query.queryLocation.includes(id)),
  ];

  return (
    <>
      <Flex
        mt={4}
        w="100%"
        mx="auto"
        gap={2}
        align="center"
        flexWrap="wrap"
        justify="space-between"
        maxW={{ base: '100%', md: '75%' }}
      >
        <Button
          ref={backRef}
          size="sm"
          variant="ghost"
          onClick={handleBack}
          leftIcon={<DynamicIcon icon={{ fi: 'FiArrowLeft' }} boxSize="16px" />}
        >
          {web.text.historyBack}
        </Button>
        <Flex direction="column" align="flex-end" textAlign="right" minW={0}>
          <Text fontSize="sm" color={muted}>
            {strF(web.text.historySavedAt, {
              time: formatTimestamp(new Date(entry.savedAt).toISOString()),
            })}
          </Text>
          {labels.variables.length > 0 && (
            <Text fontSize="sm" color={muted} overflowWrap="anywhere">
              {labels.variables.join(', ')}
            </Text>
          )}
        </Flex>
      </Flex>
      <ResultsView
        // Every saved result is complete: show them all.
        defaultIndex={deviceIds.map((_, index) => index)}
        tags={
          <Tags queryLocation={deviceIds} queryType={labels.type} queryTarget={query.queryTarget} />
        }
      >
        {deviceIds.map((id, index) => (
          <StoredResult
            key={id}
            index={index}
            deviceId={id}
            result={results[id]}
            queryTarget={query.queryTarget}
            displayTarget={labels.target}
          />
        ))}
      </ResultsView>
    </>
  );
};
