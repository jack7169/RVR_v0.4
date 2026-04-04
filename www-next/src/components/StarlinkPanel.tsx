import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Shield, Zap, Satellite, Wifi } from 'lucide-react';
import { fetchStarlinkOutages } from '../api/client';
import type { StarlinkOutageResponse, StarlinkOutageEvent } from '../api/types';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../lib/utils';

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const CAUSE_LABELS: Record<string, string> = {
  UNKNOWN: 'Unknown',
  BOOTING: 'Booting',
  STOWED: 'Stowed',
  THERMAL_SHUTDOWN: 'Thermal',
  NO_SCHEDULE: 'No schedule',
  NO_SATS: 'No satellites',
  OBSTRUCTED: 'Obstructed',
  NO_DOWNLINK: 'No downlink',
  NO_PINGS: 'Network issue',
  ACTUATOR_ACTIVITY: 'Repositioning',
  CABLE_TEST: 'Cable test',
  SLEEPING: 'Sleeping',
  SKY_SEARCH: 'Searching',
  INHIBIT_RF: 'RF inhibited',
};

function causeBadgeColor(cause: string): string {
  switch (cause) {
    case 'OBSTRUCTED': return 'text-orange-400';
    case 'NO_SATS': case 'NO_DOWNLINK': case 'NO_SCHEDULE': return 'text-yellow-400';
    case 'BOOTING': case 'ACTUATOR_ACTIVITY': case 'SKY_SEARCH': return 'text-blue-400';
    case 'THERMAL_SHUTDOWN': return 'text-red-400';
    case 'NO_PINGS': return 'text-error';
    default: return 'text-text-secondary';
  }
}

function DropTimeline({ outages, windowSeconds }: { outages: StarlinkOutageEvent[]; windowSeconds: number }) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - windowSeconds;
  const segments: { pct: number; type: 'ok' | 'drop' }[] = [];

  let cursor = start;
  const relevant = outages.filter(o => o.end > start).sort((a, b) => a.start - b.start);

  for (const o of relevant) {
    const oStart = Math.max(o.start, start);
    const oEnd = Math.min(o.end, now);
    if (oStart > cursor) {
      segments.push({ pct: (oStart - cursor) / windowSeconds * 100, type: 'ok' });
    }
    if (oEnd > oStart) {
      segments.push({ pct: Math.max((oEnd - oStart) / windowSeconds * 100, 0.3), type: 'drop' });
    }
    cursor = Math.max(cursor, oEnd);
  }
  if (cursor < now) {
    segments.push({ pct: (now - cursor) / windowSeconds * 100, type: 'ok' });
  }

  return (
    <div className="flex h-6 rounded-lg overflow-hidden bg-bg-primary">
      {segments.length === 0 ? (
        <div className="flex-1 bg-success/20" />
      ) : (
        segments.map((seg, i) => (
          <div
            key={i}
            style={{ width: `${seg.pct}%` }}
            className={seg.type === 'drop' ? 'bg-error/60' : 'bg-success/20'}
          />
        ))
      )}
    </div>
  );
}

type TimeWindow = 3600 | 21600 | 86400;

export function StarlinkPanel() {
  const [data, setData] = useState<StarlinkOutageResponse | null>(null);
  const [window, setWindow] = useState<TimeWindow>(3600);

  useEffect(() => {
    const load = () => { fetchStarlinkOutages(window).then(setData).catch(() => {}); };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [window]);

  if (!data || !data.available) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm font-semibold mb-2">
          <Satellite className="w-4 h-4 text-sky-400" />
          Starlink Link Quality
        </div>
        <div className="text-xs text-text-secondary">
          {data?.error || 'Waiting for Starlink dish...'}
        </div>
      </div>
    );
  }

  const { summary, outages, current } = data;
  const now = Math.floor(Date.now() / 1000);
  const windowOutages = outages.filter(o => o.end > now - window);

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-sky-400" />
          <h3 className="font-semibold text-sm">Starlink Link Quality</h3>
          {!current.connected ? (
            <span className="flex items-center gap-1 text-xs text-error">
              <Zap className="w-3 h-3" /> Disconnected
            </span>
          ) : summary.total_drops > 0 ? (
            <span className="flex items-center gap-1 text-xs text-warning">
              <Wifi className="w-3 h-3" /> {summary.total_drops} event{summary.total_drops !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-success">
              <Shield className="w-3 h-3" /> Clean
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {([
            { label: '1h', seconds: 3600 as TimeWindow },
            { label: '6h', seconds: 21600 as TimeWindow },
            { label: '24h', seconds: 86400 as TimeWindow },
          ]).map(w => (
            <button
              key={w.seconds}
              onClick={() => setWindow(w.seconds)}
              className={cn(
                'text-xs px-2 py-0.5 rounded transition-colors',
                window === w.seconds ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-px bg-border/50">
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', summary.uptime_pct >= 99.9 ? 'text-success' : summary.uptime_pct >= 99 ? 'text-warning' : 'text-error')}>
            {summary.uptime_pct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-text-secondary">Uptime</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', summary.total_drops > 0 ? 'text-error' : 'text-text-primary')}>
            {summary.total_drops}
          </div>
          <div className="text-[10px] text-text-secondary">Events</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className="text-xl font-bold text-text-primary">
            {summary.avg_latency_ms > 0 ? `${summary.avg_latency_ms}ms` : '--'}
          </div>
          <div className="text-[10px] text-text-secondary">Avg Latency</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', summary.total_seconds_down > 0 ? 'text-warning' : 'text-text-primary')}>
            {summary.total_seconds_down > 0 ? formatDuration(summary.total_seconds_down) : '0s'}
          </div>
          <div className="text-[10px] text-text-secondary">Downtime</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-3">
        <DropTimeline outages={outages} windowSeconds={window} />
        <div className="flex justify-between text-[10px] text-text-secondary mt-1">
          <span>{formatDuration(window)} ago</span>
          <span>Now</span>
        </div>
      </div>

      {/* Event list */}
      {windowOutages.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 py-2 text-xs text-text-secondary">Recent Events</div>
          <div className="max-h-40 overflow-y-auto">
            {windowOutages.slice().reverse().map((o, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs border-t border-border/50">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 text-error" />
                  <span className={cn('font-medium', causeBadgeColor(o.cause))}>
                    {CAUSE_LABELS[o.cause] || o.cause}
                  </span>
                  <span className="text-text-secondary">
                    {formatDistanceToNow(o.start * 1000, { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(o.duration_seconds)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
