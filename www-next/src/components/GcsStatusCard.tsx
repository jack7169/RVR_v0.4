import type { StatusResponse } from '../api/types';
import { Card, StatusRow } from './ui/Card';
import { Badge } from './ui/Badge';
import { cn } from '../lib/utils';

function ServiceStatus({ value }: { value: string }) {
  const ok = value === 'running' || value === 'up' || value === 'active' || value === 'connected';
  return <span className={ok ? 'text-success' : 'text-error'}>{value}</span>;
}

interface Props {
  status: StatusResponse;
}

export function GcsStatusCard({ status }: Props) {
  const { gcs, internet } = status;
  const healthVariant = gcs.health.status === 'OK' ? 'success'
    : gcs.health.status === 'ERROR' ? 'error'
    : gcs.health.status === 'RECOVERING' ? 'warning'
    : 'neutral';

  return (
    <Card title="GCS Status" badge={<Badge variant={healthVariant}>{gcs.health.status}</Badge>}>
      <StatusRow label="Internet">
        <span className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', internet.status === 'connected' ? 'bg-success' : 'bg-error')} />
          <ServiceStatus value={internet.status} />
        </span>
      </StatusRow>
      <StatusRow label="Tailscale IP">
        <span className="font-mono text-xs">{gcs.tailscale_ip || '--'}</span>
      </StatusRow>
      <StatusRow label="Tailscale"><ServiceStatus value={gcs.tailscale_status} /></StatusRow>
      <StatusRow label="KCPtun Server"><ServiceStatus value={gcs.services.kcptun_server} /></StatusRow>
      <StatusRow label="L2TAP"><ServiceStatus value={gcs.services.l2tap} /></StatusRow>
      <StatusRow label="L2Bridge Interface"><ServiceStatus value={gcs.services.l2bridge_interface} /></StatusRow>
      <StatusRow label="Streams">{gcs.l2tap_streams.active}/{gcs.l2tap_streams.max} ({gcs.l2tap_streams.flows} flows)</StatusRow>
      <StatusRow label="Watchdog"><ServiceStatus value={gcs.watchdog} /></StatusRow>
    </Card>
  );
}
