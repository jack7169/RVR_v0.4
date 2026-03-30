import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchStatus } from '../api/client';

export function useStatus() {
  const queryClient = useQueryClient();

  const { data: status, error: queryError, dataUpdatedAt } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 5000,
    retry: 1,
  });

  return {
    status: status ?? null,
    error: queryError ? String(queryError) : null,
    lastUpdate: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
    refresh: () => { queryClient.invalidateQueries({ queryKey: ['status'] }); },
  };
}
