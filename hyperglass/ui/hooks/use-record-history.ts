import { useEffect } from 'react';
import { useConfig } from '~/context';
import { useDevice } from './use-device';
import { useFormState } from './use-form-state';
import { useQueryHistory } from './use-query-history';

import type { Device } from '~/types';
import type { HistoryQuery } from './use-query-history';

/**
 * Whether the directive `device` runs for `query` lets its results be kept (`retain`):
 * `null` when the device has no such directive.
 *
 * The query type is one location's directive ID. Another location runs its own directive
 * of the same name (`resolve_directive_by_name` on the backend), so a query of several
 * locations can have directives that differ in `retain`. The lookup is at least as strict
 * as the backend's: when the device has no directive with the ID and several with the
 * name, all of them must retain. For example, a device with a built-in BGP Route and a
 * custom `retain: false` directive also named BGP Route, queried with another vendor's
 * ID: the backend runs the built-in, but nothing is saved. It fails closed.
 */
export function directiveRetains(
  device: Device,
  query: Pick<HistoryQuery, 'queryType' | 'queryTypeName'>,
): boolean | null {
  const byId = device.directives.filter(d => d.id === query.queryType);
  const candidates =
    byId.length > 0 ? byId : device.directives.filter(d => d.name === query.queryTypeName);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.every(d => d.retain !== false);
}

/**
 * Save a location's response to the query history while the results show, when history
 * is enabled, the response is a success and the location's directive retains its results.
 * The response is saved again each time it changes (enrichment, or the query run again),
 * in the same entry.
 *
 * @param deviceId The location's device ID.
 * @param data The location's response.
 * @param isError Whether the result is an error, as the result shows it.
 */
export function useRecordHistory(
  deviceId: string,
  data: QueryResponse | undefined,
  isError: boolean,
): void {
  const { web } = useConfig();
  const { enable, limit } = web.history;
  const getDevice = useDevice();
  const submissionId = useFormState(s => s.submissionId);
  const record = useQueryHistory(s => s.record);

  useEffect(() => {
    if (!enable || submissionId === null || data === undefined || isError) {
      return;
    }
    const device = getDevice(deviceId);
    if (device === null) {
      return;
    }
    // The query the results were requested with. It can't change while they show.
    const { form, getDirective } = useFormState.getState();
    const directive = getDirective();
    const queryTypeName = directive?.name ?? form.queryType;
    const variables = (directive?.variables ?? []).flatMap(variable => {
      const value = form.queryVariables[variable.id];
      if (value === undefined) {
        return [];
      }
      const option = variable.options.find(o => o.value === value);
      return [`${variable.name}: ${option?.name ?? value}`];
    });
    record(
      {
        submissionId,
        query: {
          queryLocation: form.queryLocation,
          queryType: form.queryType,
          queryTypeName,
          queryTarget: form.queryTarget,
          queryVariables: form.queryVariables,
        },
        labels: {
          locations: form.queryLocation.map(id => getDevice(id)?.name ?? id),
          type: directive?.name ?? form.queryType,
          target: form.queryTarget.join(', '),
          variables,
        },
        deviceId: device.id,
        result: { name: device.name, queryId: data.id, data },
        // Only a directive known to retain them: not one this device doesn't list.
        retain: directiveRetains(device, { queryType: form.queryType, queryTypeName }) === true,
      },
      limit,
    );
  }, [enable, limit, submissionId, deviceId, data, isError, getDevice, record]);
}
