import { useRef, useCallback, useEffect } from 'react';
import type { StatusResponse } from '../api/types';

export interface DataPoint {
  time: string;
  t: number;
  rx: number;
  tx: number;
  pkts: number;
}

const MAX_POINTS = 180;

export function useNetHistory(status: StatusResponse | null) {
  const historyRef = useRef<DataPoint[]>([]);
  const prevRef = useRef<{
    t: number; rx: number; tx: number; pkts: number;
  } | null>(null);
  const counterRef = useRef(0); // increments on each push to trigger re-renders

  // Push new data point via useEffect (not useMemo — side effects belong here)
  useEffect(() => {
    if (!status) return;
    const now = status.network_stats.timestamp_ms;
    const rx = status.network_stats.rvr_bridge.rx_bytes;
    const tx = status.network_stats.rvr_bridge.tx_bytes;
    const pkts = status.network_stats.rvr_bridge.rx_packets + status.network_stats.rvr_bridge.tx_packets;

    const prev = prevRef.current;
    if (prev && now > prev.t) {
      const dt = (now - prev.t) / 1000;
      if (dt > 0 && dt < 30) { // sanity: skip if gap > 30s (stale data)
        const d = new Date(now);
        historyRef.current.push({
          time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`,
          t: now,
          rx: Math.max(0, (rx - prev.rx) / dt),
          tx: Math.max(0, (tx - prev.tx) / dt),
          pkts: Math.max(0, (pkts - prev.pkts) / dt),
        });
        if (historyRef.current.length > MAX_POINTS) {
          historyRef.current = historyRef.current.slice(-MAX_POINTS);
        }
        counterRef.current++;
      }
    }
    prevRef.current = { t: now, rx, tx, pkts };
  }, [status]);

  const getWindow = useCallback((seconds: number): DataPoint[] => {
    const h = historyRef.current;
    if (h.length === 0) return [];
    const cutoff = h[h.length - 1].t - seconds * 1000;
    return h.filter(p => p.t >= cutoff);
  }, []);

  const current = (() => {
    const h = historyRef.current;
    if (h.length === 0) return { rx: 0, tx: 0, pkts: 0 };
    return h[h.length - 1];
  })();

  return { getWindow, current, count: counterRef.current };
}
