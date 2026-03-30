import type { StatusResponse } from '../api/types';
import { Card, StatusRow } from './ui/Card';
import { Badge } from './ui/Badge';

function ServiceStatus({ value }: { value: string }) {
  const ok = value === 'running' || value === 'up';
  const unknown = value === 'unknown';
  return <span className={ok ? 'text-success' : unknown ? 'text-text-secondary' : 'text-error'}>{value}</span>;
}

interface Props {
  status: StatusResponse;
}

export function AircraftStatusCard({ status }: Props) {
  const { aircraft } = status;

  return (
    <Card
      title="Aircraft Status"
      badge={<Badge variant={aircraft.reachable ? 'success' : 'error'}>{aircraft.reachable ? 'Reachable' : 'Unreachable'}</Badge>}
    >
      <StatusRow label="Profile">{aircraft.profile_name || 'None'}</StatusRow>
      <StatusRow label="Tailscale IP">
        <span className="font-mono text-xs">{aircraft.tailscale_ip || '--'}</span>
      </StatusRow>
      <StatusRow label="Reachable">
        <span className={aircraft.reachable ? 'text-success' : 'text-error'}>{aircraft.reachable ? 'Yes' : 'No'}</span>
      </StatusRow>
      <StatusRow label="Tailscale Link">
        <span className={aircraft.tailscale_peer.mode === 'direct' ? 'text-success' : aircraft.tailscale_peer.mode === 'relay' ? 'text-warning' : 'text-text-secondary'}>
          {aircraft.tailscale_peer.mode}
          {aircraft.tailscale_peer.relay && ` (${aircraft.tailscale_peer.relay})`}
        </span>
      </StatusRow>
      <StatusRow label="KCPtun Client"><ServiceStatus value={aircraft.services.kcptun_client} /></StatusRow>
      <StatusRow label="L2TAP"><ServiceStatus value={aircraft.services.l2tap} /></StatusRow>
      <StatusRow label="L2Bridge Interface"><ServiceStatus value={aircraft.services.l2bridge_interface} /></StatusRow>
    </Card>
  );
}
