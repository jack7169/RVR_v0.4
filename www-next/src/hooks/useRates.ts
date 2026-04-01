import { useRef, useMemo } from 'react';
import type { StatusResponse } from '../api/types';

interface RateData {
  rxRate: number;
  txRate: number;
  packetRate: number;
  filterDropRate: number;
}

export function useRates(status: StatusResponse | null): RateData {
  const prevRef = useRef<{
    timestamp: number;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    filterDropped: number;
  } | null>(null);

  return useMemo(() => {
    if (!status) return { rxRate: 0, txRate: 0, packetRate: 0, filterDropRate: 0 };

    const now = status.network_stats.timestamp_ms;
    const rx = status.network_stats.rvr_bridge.rx_bytes;
    const tx = status.network_stats.rvr_bridge.tx_bytes;
    const pkts = status.network_stats.rvr_bridge.rx_packets + status.network_stats.rvr_bridge.tx_packets;
    const dropped = status.bridge_filter.dropped_packets;

    const prev = prevRef.current;
    let rxRate = 0, txRate = 0, packetRate = 0, filterDropRate = 0;

    if (prev && now > prev.timestamp) {
      const dt = (now - prev.timestamp) / 1000;
      rxRate = Math.max(0, (rx - prev.rxBytes) / dt);
      txRate = Math.max(0, (tx - prev.txBytes) / dt);
      packetRate = Math.max(0, (pkts - prev.txPackets - prev.rxPackets + prev.rxPackets + prev.txPackets - prev.rxPackets - prev.txPackets) / dt);
      // Simplified: just use total packets delta
      const prevPkts = prev.rxPackets + prev.txPackets;
      packetRate = Math.max(0, (pkts - prevPkts) / dt);
      filterDropRate = Math.max(0, (dropped - prev.filterDropped) / dt);
    }

    prevRef.current = { timestamp: now, rxBytes: rx, txBytes: tx, rxPackets: status.network_stats.rvr_bridge.rx_packets, txPackets: status.network_stats.rvr_bridge.tx_packets, filterDropped: dropped };

    return { rxRate, txRate, packetRate, filterDropRate };
  }, [status]);
}
