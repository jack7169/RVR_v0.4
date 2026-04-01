import { Plane, Wifi, Server, Layers, Network, Signal } from 'lucide-react';
import type { StatusResponse } from '../api/types';
import { Card, StatusRow } from './ui/Card';
import { Badge } from './ui/Badge';

function ServiceStatus({ value }: { value: string }) {
  const ok = value === 'running' || value === 'up';
  const unknown = value === 'unknown';
  return <span className={ok ? 'text-success' : unknown ? 'text-text-secondary' : 'text-error'}>{value}</span>;
}

function IconLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 text-text-secondary/60" />
      {label}
    </span>
  );
}

interface Props {
  status: StatusResponse;
}

export function AircraftStatusCard({ status }: Props) {
  const { aircraft, role } = status;
  const title = role === 'aircraft' ? 'Remote Status (GCS)' : 'Remote Status (Aircraft)';

  return (
    <Card
      title={title}
      badge={<Badge variant={aircraft.reachable ? 'success' : aircraft.tailscale_ip ? 'error' : 'neutral'}>{aircraft.reachable ? 'Reachable' : aircraft.tailscale_ip ? 'Unreachable' : 'Not bound'}</Badge>}
    >
      <StatusRow label={<IconLabel icon={Plane} label="Profile" />}>{aircraft.profile_name || 'None'}</StatusRow>
      <StatusRow label={<IconLabel icon={Wifi} label="VPN IP" />}>
        <span className="font-mono text-xs">{aircraft.tailscale_ip || '--'}</span>
      </StatusRow>
      <StatusRow label={<IconLabel icon={Signal} label="Link Mode" />}>
        <span className={aircraft.tailscale_peer.mode === 'direct' ? 'text-success' : aircraft.tailscale_peer.mode === 'relay' ? 'text-warning' : 'text-text-secondary'}>
          {aircraft.tailscale_peer.mode}
          {aircraft.tailscale_peer.relay && ` (${aircraft.tailscale_peer.relay})`}
        </span>
      </StatusRow>
      <StatusRow label={<IconLabel icon={Server} label={role === 'aircraft' ? 'KCPtun Server' : 'KCPtun Client'} />}><ServiceStatus value={aircraft.services.kcptun_client} /></StatusRow>
      <StatusRow label={<IconLabel icon={Layers} label="L2TAP" />}><ServiceStatus value={aircraft.services.l2tap} /></StatusRow>
      <StatusRow label={<IconLabel icon={Network} label="Bridge Interface" />}><ServiceStatus value={aircraft.services.l2bridge_interface} /></StatusRow>
    </Card>
  );
}
