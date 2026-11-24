import { Button } from '@chakra-ui/react';
import { useCallback } from 'react';
import { ShareButton } from '~/components/results';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import { directiveRetains, isLiveLink, useDevice, useSavedShareLinks } from '~/hooks';

import type { HistoryEntry, SavedShare } from '~/hooks';

/**
 * Whether a saved result of location `deviceId` gets a Share button: as a live result
 * does (#561), with sharing on, a location that is still configured and whose directive
 * retains its results, and an enrichment that had finished when it was saved. Whether the
 * server still holds it is only known by asking.
 */
export function useHistoryShareable(): (entry: HistoryEntry, deviceId: string) => boolean {
  const { share } = useConfig();
  const getDevice = useDevice();
  return useCallback(
    (entry: HistoryEntry, deviceId: string): boolean => {
      const result = entry.results[deviceId];
      const device = getDevice(deviceId);
      return (
        share.enable &&
        result !== undefined &&
        device !== null &&
        directiveRetains(device, entry.query) === true &&
        result.data.enrichment !== 'pending'
      );
    },
    [share.enable, getDevice],
  );
}

/**
 * Whether a result of `entry` has a live link saved in this browser: one made from that
 * result (its query id and time), not from an earlier or later run of the same query.
 */
export function hasSavedLink(entry: HistoryEntry, links: SavedShare[]): boolean {
  const now = Date.now();
  return Object.values(entry.results).some(result =>
    links.some(
      l =>
        l.queryId === result.queryId && l.timestamp === result.data.timestamp && isLiveLink(l, now),
    ),
  );
}

interface HistoryShareButtonProps {
  entry: HistoryEntry;
  /** The location (device) ID of the result to share. */
  deviceId: string;
  /** Run the entry's query again, offered once the server no longer holds the result. */
  onRerun(): void;
}

/**
 * The Share button of a saved result. It sends the saved result's id and time, so the
 * server shares that result or none, and keeps its links in this browser's store of shared
 * links, where "Your shared links" lists them too: never in the history entry.
 */
export const HistoryShareButton = (props: HistoryShareButtonProps): JSX.Element => {
  const { entry, deviceId, onRerun } = props;
  const { web } = useConfig();
  const result = entry.results[deviceId];
  const { links, onAdd, onRemove } = useSavedShareLinks(result.queryId, {
    location: result.name,
    type: entry.labels.type,
    target: entry.labels.target,
  });

  return (
    <ShareButton
      queryId={result.queryId}
      timestamp={result.data.timestamp}
      links={links}
      onAdd={onAdd}
      onRemove={onRemove}
      resultExpiredAction={
        <Button
          size="sm"
          variant="outline"
          onClick={onRerun}
          leftIcon={<DynamicIcon icon={{ fi: 'FiRepeat' }} boxSize="16px" />}
        >
          {web.text.historyRerun}
        </Button>
      }
    />
  );
};
