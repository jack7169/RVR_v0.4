import { useRef, useCallback, useMemo } from 'react';
import type { StatusResponse } from '../api/types';

export interface DataPoint {
  time: string;  // HH:mm:ss for chart labels
  t: number;     // timestamp ms
  rx: number;    // bytes/s
  tx: number;    // bytes/s
  pkts: number;  // packets/s
}

const MAX_POINTS = 180; // 15min at 5s polling

export function useNetHistory(status: StatusResponse | null) {
  const historyRef = useRef<DataPoint[]>([]);
  const prevRef = useRef<{
    t: number; rx: number; tx: number; pkts: number;
  } | null>(null);

  // Push new data point on each status update
  useMemo(() => {
    if (!status) return;
    const now = status.network_stats.timestamp_ms;
    const rx = status.network_stats.l2bridge.rx_bytes;
    const tx = status.network_stats.l2bridge.tx_bytes;
    const pkts = status.network_stats.l2bridge.rx_packets + status.network_stats.l2bridge.tx_packets;

    const prev = prevRef.current;
    if (prev && now > prev.t) {
      const dt = (now - prev.t) / 1000;
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
    }
    prevRef.current = { t: now, rx, tx, pkts };
  }, [status]);

  const getWindow = useCallback((seconds: number): DataPoint[] => {
    const h = historyRef.current;
    if (h.length === 0) return [];
    const cutoff = h[h.length - 1].t - seconds * 1000;
    return h.filter(p => p.t >= cutoff);
  }, []);

  // Current rates (latest data point)
  const current = useMemo(() => {
    const h = historyRef.current;
    if (h.length === 0) return { rx: 0, tx: 0, pkts: 0 };
    return h[h.length - 1];
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return { getWindow, current, history: historyRef };
}
