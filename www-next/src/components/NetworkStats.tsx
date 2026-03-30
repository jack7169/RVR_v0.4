import type { StatusResponse } from '../api/types';
import { Card, StatusRow } from './ui/Card';
import { formatBytes, formatRate, formatPackets } from '../lib/utils';
import { useRates } from '../hooks/useRates';

interface Props {
  status: StatusResponse;
}

export function NetworkStats({ status }: Props) {
  const rates = useRates(status);
  const { l2bridge, tailscale } = status.network_stats;
  const { bridge_filter } = status;

  return (
    <Card title="Network Statistics">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <div className="text-xs text-text-secondary mb-1">Bridge Traffic</div>
          <StatusRow label="RX Rate">{formatRate(rates.rxRate)}</StatusRow>
          <StatusRow label="TX Rate">{formatRate(rates.txRate)}</StatusRow>
          <StatusRow label="Packet Rate">{formatPackets(Math.round(rates.packetRate))}/s</StatusRow>
          <StatusRow label="RX Total">{formatBytes(l2bridge.rx_bytes)}</StatusRow>
          <StatusRow label="TX Total">{formatBytes(l2bridge.tx_bytes)}</StatusRow>
          <StatusRow label="Errors">{l2bridge.rx_errors + l2bridge.tx_errors}</StatusRow>
          <StatusRow label="Dropped">{l2bridge.rx_dropped + l2bridge.tx_dropped}</StatusRow>
        </div>
        <div>
          <div className="text-xs text-text-secondary mb-1">WAN Filter</div>
          <StatusRow label="Status">
            <span className={bridge_filter.active ? 'text-success' : 'text-error'}>
              {bridge_filter.active ? 'Active' : 'Inactive'}
            </span>
          </StatusRow>
          <StatusRow label="Blocked Pkts">{formatPackets(bridge_filter.dropped_packets)}</StatusRow>
          <StatusRow label="Blocked Data">{formatBytes(bridge_filter.dropped_bytes)}</StatusRow>
          <StatusRow label="Block Rate">{formatPackets(Math.round(rates.filterDropRate))}/s</StatusRow>
          <div className="mt-3">
            <div className="text-xs text-text-secondary mb-1">Tailscale WAN</div>
            <StatusRow label="Interface">{tailscale.interface}</StatusRow>
            <StatusRow label="RX">{formatBytes(tailscale.rx_bytes)}</StatusRow>
            <StatusRow label="TX">{formatBytes(tailscale.tx_bytes)}</StatusRow>
          </div>
        </div>
      </div>
    </Card>
  );
}
