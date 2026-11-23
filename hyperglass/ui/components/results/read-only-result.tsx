import { useMemo } from 'react';
import { Path } from '~/components';
import { CopyButton } from './copy-button';
import { ResultPanel } from './individual';

import type { ResultQueryState } from './individual';

export interface ReadOnlyResultProps {
  index: number;
  /** The device the result is from. `name` is the header's title. */
  location: { id: string; name: string };
  /** A complete, successful response. */
  data: QueryResponse;
  queryTarget: string[];
  /** The query target as shown, for the AS path's title. */
  displayTarget: string;
}

/**
 * A response kept from earlier (a saved history entry, a shared result), read-only: no
 * request, no polling, no requery. Its buttons are copy and, for a structured BGP table,
 * the AS path without lookups. It must be inside an `Accordion` (see `ResultsView`).
 */
export const ReadOnlyResult = (props: ReadOnlyResultProps): JSX.Element => {
  const { index, location, data, queryTarget, displayTarget } = props;
  // Not shown as a cached response: the page shows when it was produced instead.
  const query = useMemo<ResultQueryState>(
    () => ({
      data: { ...data, cached: false },
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchedAfterMount: true,
    }),
    [data],
  );
  return (
    <ResultPanel
      index={index}
      location={location}
      queryTarget={queryTarget}
      query={query}
      errorLevel="success"
      buttons={({ copyValue, showPath }) => (
        <>
          {/* Without `onEnriched`, the AS path makes no request. */}
          {showPath && <Path response={data} displayTarget={displayTarget} />}
          <CopyButton copyValue={copyValue} />
        </>
      )}
    />
  );
};
