import { Button } from '@chakra-ui/react';
import { useCallback } from 'react';
import { ShareButton } from '~/components/results';
import { useConfig } from '~/context';
import { DynamicIcon } from '~/elements';
import { directiveRetains, shareKey, useDevice, useQueryHistory, useShareLinks } from '~/hooks';

import type { CreatedShare, HistoryEntry } from '~/hooks';

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

interface HistoryShareButtonProps {
  entry: HistoryEntry;
  /** The location (device) ID of the result to share. */
  deviceId: string;
  /** Run the entry's query again, offered once the server no longer holds the result. */
  onRerun(): void;
}

/**
 * The Share button of a saved result. The link it creates is kept with the result in the
 * history, with its delete token, so the visitor can copy or delete it later, from any tab.
 *
 * When the history can't keep it (the entry was deleted in another tab, or is too large
 * for the browser's storage), the link is kept in the page's memory instead, as a live
 * result's is (`useShareLinks`), and a link created from the same result in the results
 * view shows here too.
 */
export const HistoryShareButton = (props: HistoryShareButtonProps): JSX.Element => {
  const { entry, deviceId, onRerun } = props;
  const { web } = useConfig();
  const result = entry.results[deviceId];
  const key = shareKey(result.queryId, result.data.timestamp);
  const inMemory = useShareLinks(s => s.links[key] ?? null);
  const save = useShareLinks(s => s.save);
  const setShare = useQueryHistory(s => s.setShare);

  const onChange = useCallback(
    (next: CreatedShare | null) => {
      const saved = setShare(entry.id, deviceId, next);
      // Kept in one place only.
      save(key, saved ? null : next);
    },
    [entry.id, deviceId, key, setShare, save],
  );

  return (
    <ShareButton
      queryId={result.queryId}
      timestamp={result.data.timestamp}
      share={result.share ?? inMemory}
      onChange={onChange}
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
