import { Globe, Server, Layers, Network, Shield, Wifi } from 'lucide-react';
import type { StatusResponse } from '../api/types';
import { Card, StatusRow } from './ui/Card';
import { Badge } from './ui/Badge';
import { cn } from '../lib/utils';

function ServiceStatus({ value }: { value: string }) {
  const ok = value === 'running' || value === 'up' || value === 'active' || value === 'connected';
  return <span className={ok ? 'text-success' : 'text-error'}>{value}</span>;
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

export function GcsStatusCard({ status }: Props) {
  const { gcs, internet, role } = status;
  const title = role === 'aircraft' ? 'Local Status (Aircraft)' : 'Local Status (GCS)';
  const kcptunLabel = role === 'aircraft' ? 'KCPtun Client' : 'KCPtun Server';
  const healthVariant = gcs.health.status === 'OK' ? 'success'
    : gcs.health.status === 'ERROR' ? 'error'
    : gcs.health.status === 'RECOVERING' ? 'warning'
    : 'neutral';

  return (
    <Card title={title} badge={<Badge variant={healthVariant}>{gcs.health.status}</Badge>}>
      <StatusRow label={<IconLabel icon={Globe} label="Internet" />}>
        <span className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', internet.status === 'connected' ? 'bg-success' : 'bg-error')} />
          <ServiceStatus value={internet.status} />
        </span>
      </StatusRow>
      <StatusRow label={<IconLabel icon={Wifi} label="VPN IP" />}>
        <span className="font-mono text-xs">{gcs.tailscale_ip || '--'}</span>
      </StatusRow>
      <StatusRow label={<IconLabel icon={Wifi} label="VPN" />}><ServiceStatus value={gcs.tailscale_status} /></StatusRow>
      <StatusRow label={<IconLabel icon={Server} label={kcptunLabel} />}><ServiceStatus value={gcs.services.kcptun_server} /></StatusRow>
      <StatusRow label={<IconLabel icon={Layers} label="L2TAP" />}><ServiceStatus value={gcs.services.l2tap} /></StatusRow>
      <StatusRow label={<IconLabel icon={Network} label="Bridge Interface" />}><ServiceStatus value={gcs.services.l2bridge_interface} /></StatusRow>
      <StatusRow label={<IconLabel icon={Layers} label="Streams" />}>{gcs.l2tap_streams.active}/{gcs.l2tap_streams.max} ({gcs.l2tap_streams.flows} flows)</StatusRow>
      <StatusRow label={<IconLabel icon={Shield} label="Watchdog" />}><ServiceStatus value={gcs.watchdog} /></StatusRow>
    </Card>
  );
}
