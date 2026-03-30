import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Shield, Zap, Ban } from 'lucide-react';
import { fetchOutages } from '../api/client';
import type { OutageResponse, OutageEvent, StatusResponse } from '../api/types';
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
  const segments: { pct: number; outage: boolean }[] = [];

  // Build segments from outage events
  let cursor = start;
  const relevant = outages.filter(o => o.end > start).sort((a, b) => a.start - b.start);

  for (const o of relevant) {
    const oStart = Math.max(o.start, start);
    const oEnd = Math.min(o.end, now);
    if (oStart > cursor) {
      segments.push({ pct: (oStart - cursor) / windowSeconds * 100, outage: false });
    }
    segments.push({ pct: (oEnd - oStart) / windowSeconds * 100, outage: true });
    cursor = oEnd;
  }
  if (cursor < now) {
    segments.push({ pct: (now - cursor) / windowSeconds * 100, outage: false });
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
            className={seg.outage ? 'bg-error/60' : 'bg-success/20'}
          />
        ))
      )}
    </div>
  );
}

type TimeWindow = 3600 | 21600 | 86400;

export function OutagePanel({ status }: { status?: StatusResponse | null }) {
  const [data, setData] = useState<OutageResponse | null>(null);
  const [window, setWindow] = useState<TimeWindow>(3600);

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

  const { summary, outages, current } = data;
  const now = Math.floor(Date.now() / 1000);
  const windowOutages = outages.filter(o => o.end > now - window);

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Link Quality</h3>
          {current.in_outage ? (
            <span className="flex items-center gap-1 text-xs text-error">
              <Zap className="w-3 h-3" /> Retransmitting
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
      <div className="grid grid-cols-5 gap-px bg-border/50">
        <div className="bg-bg-card p-3 text-center">
          <div className={cn('text-xl font-bold', summary.uptime_pct >= 99 ? 'text-success' : summary.uptime_pct >= 95 ? 'text-warning' : 'text-error')}>
            {summary.uptime_pct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-text-secondary">Uptime</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className="text-xl font-bold text-text-primary">{summary.total_outages}</div>
          <div className="text-[10px] text-text-secondary">Outages</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className="text-xl font-bold text-text-primary">{formatDurationShort(summary.total_outage_seconds)}</div>
          <div className="text-[10px] text-text-secondary">Total Down</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          <div className="text-xl font-bold text-text-primary">{summary.total_retrans}</div>
          <div className="text-[10px] text-text-secondary">Retransmits</div>
        </div>
        <div className="bg-bg-card p-3 text-center">
          {(() => {
            const drops = (status?.gcs.l2tap_streams.soft_drops ?? 0) + (status?.gcs.l2tap_streams.hard_drops ?? 0);
            return (
              <>
                <div className={cn('text-xl font-bold', drops > 0 ? 'text-error' : 'text-text-primary')}>
                  {drops > 0 ? <Ban className="w-5 h-5 inline" /> : null} {drops}
                </div>
                <div className="text-[10px] text-text-secondary">Latency Drops</div>
              </>
            );
          })()}
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
          <div className="px-4 py-2 text-xs text-text-secondary">Recent Outages</div>
          <div className="max-h-32 overflow-y-auto">
            {windowOutages.slice().reverse().map((o, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs border-t border-border/50">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-error flex-shrink-0" />
                  <span className="text-text-secondary">
                    {formatDistanceToNow(o.start * 1000, { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-text-secondary">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDurationShort(o.duration_seconds)}
                  </span>
                  <span>{o.retrans_count} retrans</span>
                  {o.lost_count > 0 && <span className="text-error">{o.lost_count} lost</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
