import { useRef, useCallback, useEffect, useState } from 'react';
import type { StatusResponse } from '../api/types';
import { fetchStatsHistory } from '../api/client';

export type TimeWindow = 15 | 60 | 300 | 900 | 3600 | 21600 | 86400;

export interface DataPoint {
  time: string;
  t: number;
  rx: number;
  tx: number;
  pkts: number;
  wan_rx: number;
  wan_tx: number;
}

const MAX_POINTS = 7200; // 6h at ~3s intervals

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function useNetHistory(status: StatusResponse | null) {
  const historyRef = useRef<DataPoint[]>([]);
  const prevRef = useRef<{
    t: number; rx: number; tx: number; pkts: number; wan_rx: number; wan_tx: number;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const seededRef = useRef(false);

  // Seed with server history once on mount
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    fetchStatsHistory(21600).then(res => {
      if (res.points.length > 0) {
        const serverPoints: DataPoint[] = res.points.map(p => ({
          time: formatTime(p.t),
          t: p.t,
          rx: p.rx,
          tx: p.tx,
          pkts: p.pkts,
          wan_rx: p.wan_rx ?? 0,
          wan_tx: p.wan_tx ?? 0,
        }));
        // Prepend server data before any live data already collected
        const liveStart = historyRef.current.length > 0 ? historyRef.current[0].t : Infinity;
        const older = serverPoints.filter(p => p.t < liveStart);
        historyRef.current = [...older, ...historyRef.current].slice(-MAX_POINTS);
        setRevision(r => r + 1);
      }
    }).catch(() => {});
  }, []);

  // Append live data points from status polls
  useEffect(() => {
    if (!status) return;
    const now = status.network_stats.timestamp_ms;
    const rx = status.network_stats.rvr_bridge.rx_bytes;
    const tx = status.network_stats.rvr_bridge.tx_bytes;
    const pkts = status.network_stats.rvr_bridge.rx_packets + status.network_stats.rvr_bridge.tx_packets;
    const wan_rx = status.network_stats.wan?.rx_bytes ?? 0;
    const wan_tx = status.network_stats.wan?.tx_bytes ?? 0;

    const prev = prevRef.current;
    if (prev && now > prev.t) {
      const dt = (now - prev.t) / 1000;
      if (dt > 0 && dt < 30) {
        historyRef.current.push({
          time: formatTime(now),
          t: now,
          rx: Math.max(0, (rx - prev.rx) / dt),
          tx: Math.max(0, (tx - prev.tx) / dt),
          pkts: Math.max(0, (pkts - prev.pkts) / dt),
          wan_rx: Math.max(0, (wan_rx - prev.wan_rx) / dt),
          wan_tx: Math.max(0, (wan_tx - prev.wan_tx) / dt),
        });
        if (historyRef.current.length > MAX_POINTS) {
          historyRef.current = historyRef.current.slice(-MAX_POINTS);
        }
        setRevision(r => r + 1);
      }
    }
    prevRef.current = { t: now, rx, tx, pkts, wan_rx, wan_tx };
  }, [status]);

  const getWindow = useCallback((seconds: number): DataPoint[] => {
    const h = historyRef.current;
    if (h.length === 0) return [];
    const cutoff = h[h.length - 1].t - seconds * 1000;
    return h.filter(p => p.t >= cutoff);
  }, []);

  const current = (() => {
    const h = historyRef.current;
    if (h.length === 0) return { time: '', t: 0, rx: 0, tx: 0, pkts: 0, wan_rx: 0, wan_tx: 0 };
    return h[h.length - 1];
  })();

  return { getWindow, current, revision };
}
