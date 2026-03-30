import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchStatus } from '../api/client';
import type { StatusResponse } from '../api/types';

const POLL_INTERVAL = 5000;

export function useStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setStatus(data);
      setError(null);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch status');
    }
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [refresh]);

  return { status, error, lastUpdate, refresh };
}
