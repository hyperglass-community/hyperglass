import { useEffect } from 'react';
import { useConfig } from '~/context';
import { useDevice } from './use-device';
import { useFormState } from './use-form-state';
import { useQueryHistory } from './use-query-history';

/**
 * Save a location's response to the query history while the results show, when history
 * is enabled and the response is a success. The response is saved again each time it
 * changes (enrichment, or the query run again), in the same entry.
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
          queryTypeName: directive?.name ?? form.queryType,
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
      },
      limit,
    );
  }, [enable, limit, submissionId, deviceId, data, isError, getDevice, record]);
}
