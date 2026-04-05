import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Shield, Zap } from 'lucide-react';
import { fetchOutages } from '../api/client';
import type { OutageResponse, OutageEvent } from '../api/types';
import type { TimeWindow } from '../hooks/useNetHistory';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../lib/utils';

function formatDurationShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// Timeline bar: horizontal segments showing ok (green) / outage (red)
function OutageTimeline({ outages, windowSeconds }: { outages: OutageEvent[]; windowSeconds: number }) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - windowSeconds;
  const segments: { pct: number; type: 'ok' | 'loss' | 'recovery' }[] = [];

  let cursor = start;
  const relevant = outages.filter(o => o.end > start).sort((a, b) => a.start - b.start);

  for (const o of relevant) {
    const oStart = Math.max(o.start, start);
    const oEnd = Math.min(o.end, now);
    if (oStart > cursor) {
      segments.push({ pct: (oStart - cursor) / windowSeconds * 100, type: 'ok' });
    }
    segments.push({ pct: (oEnd - oStart) / windowSeconds * 100, type: o.type === 'loss' ? 'loss' : 'recovery' });
    cursor = oEnd;
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
            style={{ width: `${Math.max(seg.pct, 0.5)}%` }}
            className={seg.type === 'loss' ? 'bg-error/60' : seg.type === 'recovery' ? 'bg-warning/40' : 'bg-success/20'}
          />
        ))
      )}
    </div>
  );
}

const WINDOWS: { label: string; seconds: TimeWindow }[] = [
  { label: '15s', seconds: 15 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
];

export function OutagePanel() {
  const [data, setData] = useState<OutageResponse | null>(null);
  const [window, setWindow] = useState<TimeWindow>(900);

  useEffect(() => {
    const load = () => { fetchOutages().then(setData).catch(() => {}); };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!data) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <div className="text-sm font-semibold mb-2">Link Quality</div>
        <div className="text-xs text-text-secondary">Waiting for KCPtun stats...</div>
      </div>
    );
  }

  const { outages, current } = data;
  const now = Math.floor(Date.now() / 1000);
  const windowOutages = outages.filter(o => o.end > now - window);

  // Compute summary from visible events (API summary covers full log, not windowed)
  const totalRetrans = windowOutages.reduce((s, o) => s + o.retrans_count, 0);
  const totalLost = windowOutages.reduce((s, o) => s + o.lost_count, 0);
  const totalRecoverySeconds = windowOutages.reduce((s, o) => s + o.duration_seconds, 0);
  const lossEvents = windowOutages.filter(o => o.lost_count > 0).length;
  const uptimePct = window > 0 && totalLost > 0
    ? Math.max(0, (window - totalRecoverySeconds) / window * 100)
    : 100;

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Link Quality</h3>
          {current.in_outage ? (
            <span className="flex items-center gap-1 text-xs text-error">
              <Zap className="w-3 h-3" /> Packet Loss
            </span>
          ) : current.in_recovery ? (
            <span className="flex items-center gap-1 text-xs text-warning">
              <Zap className="w-3 h-3" /> Recovering
            </span>
          ) : windowOutages.length > 0 ? (
            <span className="flex items-center gap-1 text-xs text-warning">
              <Zap className="w-3 h-3" /> {windowOutages.length} event{windowOutages.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-success">
              <Shield className="w-3 h-3" /> Clean
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
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
      <div className="grid grid-cols-5 gap-px bg-border/50">
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', uptimePct >= 99.9 ? 'text-success' : uptimePct >= 99 ? 'text-warning' : 'text-error')}>
            {uptimePct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-text-secondary">Uptime</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', totalLost > 0 ? 'text-error' : 'text-text-primary')}>
            {totalLost}
          </div>
          <div className="text-[10px] text-error">Lost Packets</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', lossEvents > 0 ? 'text-error' : 'text-text-primary')}>
            {lossEvents}
          </div>
          <div className="text-[10px] text-text-secondary">Loss Events</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className="text-xl font-bold text-warning">{totalRetrans}</div>
          <div className="text-[10px] text-warning">Retransmits</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className="text-xl font-bold text-text-primary">{windowOutages.length}</div>
          <div className="text-[10px] text-text-secondary">Events</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-3">
        <OutageTimeline outages={outages} windowSeconds={window} />
        <div className="flex justify-between text-[10px] text-text-secondary mt-1">
          <span>{formatDurationShort(window)} ago</span>
          <span>Now</span>
        </div>
      </div>

      {/* Outage list */}
      {windowOutages.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 py-2 text-xs text-text-secondary">Recent Events</div>
          <div className="max-h-32 overflow-y-auto">
            {windowOutages.slice().reverse().map((o, i) => {
              const isLoss = o.type === 'loss';
              return (
                <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={cn('w-3 h-3 flex-shrink-0', isLoss ? 'text-error' : 'text-warning')} />
                    <span className={cn('font-medium', isLoss ? 'text-error' : 'text-warning')}>
                      {isLoss ? 'LOSS' : 'RECOVERY'}
                    </span>
                    <span className="text-text-secondary">
                      {formatDistanceToNow(o.start * 1000, { addSuffix: true })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-text-secondary">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDurationShort(o.duration_seconds)}
                    </span>
                    <span className="text-warning">{o.retrans_count} retrans</span>
                    {o.lost_count > 0 && <span className="text-error">{o.lost_count} lost</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
