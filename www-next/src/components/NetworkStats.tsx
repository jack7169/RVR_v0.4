import { useState, useEffect, useMemo, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ArrowDown, ArrowUp, Activity, AlertTriangle } from 'lucide-react';
import type { StatusResponse } from '../api/types';
import { fetchStatsHistory } from '../api/client';
import { useNetHistory, type DataPoint } from '../hooks/useNetHistory';
import { formatBytes, formatRate, formatPackets } from '../lib/utils';
import { cn } from '../lib/utils';

interface Props {
  status: StatusResponse;
}

type TimeWindow = 15 | 60 | 300 | 900 | 3600 | 21600;

const WINDOWS: { label: string; seconds: TimeWindow }[] = [
  { label: '15s', seconds: 15 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
];

function StatTile({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-bg-primary rounded-xl p-3 flex items-center gap-3">
      <div className={cn('p-2 rounded-lg', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-text-primary truncate">{value}</div>
        <div className="text-xs text-text-secondary">{label}</div>
        {sub && <div className="text-xs text-text-secondary/60">{sub}</div>}
      </div>
    </div>
  );
}

function formatChartRate(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}MB/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}KB/s`;
  return `${Math.round(value)}B/s`;
}

export function NetworkStats({ status }: Props) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(60);
  const [allHistory, setAllHistory] = useState<DataPoint[]>([]);
  const fetchedRef = useRef(false);
  const { getWindow, current } = useNetHistory(status);
  const { l2bridge, tailscale } = status.network_stats;
  const { bridge_filter } = status;

  // Fetch full 6h server history ONCE on mount, then slice client-side
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchStatsHistory(21600).then(res => {
      setAllHistory(res.points.map(p => {
        const d = new Date(p.t);
        return {
          time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          t: p.t, rx: p.rx, tx: p.tx, pkts: p.pkts,
        };
      }));
    }).catch(() => {});
  }, []);

  // Slice from cached server history for the selected window — instant, no fetch
  const data = useMemo(() => {
    const clientData = getWindow(timeWindow);
    // Once client has enough live data, prefer it (live updates)
    if (clientData.length >= 3) return clientData;
    // Otherwise slice server history for the requested window
    if (allHistory.length > 0) {
      const cutoff = allHistory[allHistory.length - 1].t - timeWindow * 1000;
      return allHistory.filter(p => p.t >= cutoff);
    }
    return clientData;
  }, [timeWindow, allHistory, getWindow, status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold">Network Statistics</h3>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button
              key={w.seconds}
              onClick={() => setTimeWindow(w.seconds)}
              className={cn(
                'text-xs px-2.5 py-1 rounded-md transition-colors',
                timeWindow === w.seconds
                  ? 'bg-accent text-white'
                  : 'bg-bg-primary text-text-secondary hover:text-text-primary',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
        <StatTile
          icon={<ArrowDown className="w-4 h-4 text-emerald-400" />}
          label="RX Rate"
          value={formatRate(current.rx)}
          sub={`${formatBytes(l2bridge.rx_bytes)} total`}
          color="bg-emerald-500/10"
        />
        <StatTile
          icon={<ArrowUp className="w-4 h-4 text-blue-400" />}
          label="TX Rate"
          value={formatRate(current.tx)}
          sub={`${formatBytes(l2bridge.tx_bytes)} total`}
          color="bg-blue-500/10"
        />
        <StatTile
          icon={<Activity className="w-4 h-4 text-amber-400" />}
          label="Packet Rate"
          value={`${formatPackets(Math.round(current.pkts))}/s`}
          sub={`${formatPackets(l2bridge.rx_packets + l2bridge.tx_packets)} total`}
          color="bg-amber-500/10"
        />
        <StatTile
          icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          label="Errors / Drops"
          value={`${l2bridge.rx_errors + l2bridge.tx_errors} / ${l2bridge.rx_dropped + l2bridge.tx_dropped}`}
          sub={bridge_filter.active ? `${formatPackets(bridge_filter.dropped_packets)} filtered` : 'Filter inactive'}
          color="bg-red-500/10"
        />
      </div>

      {/* Chart */}
      <div className="px-4 pb-2">
        <div className="h-48 w-full">
          {data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={formatChartRate}
                  width={65}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value) => formatRate(Number(value))}
                />
                <Area
                  type="monotone"
                  dataKey="rx"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fill="url(#rxGrad)"
                  dot={false}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  fill="url(#txGrad)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-text-secondary">
              Collecting data... ({data.length} samples)
            </div>
          )}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-6 py-2 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-500 rounded" /> RX
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-blue-500 rounded" /> TX
          </span>
        </div>
      </div>

      {/* Footer stats */}
      <div className="grid grid-cols-3 gap-px bg-border/50 border-t border-border text-center text-xs">
        <div className="bg-bg-card py-2">
          <div className="text-text-secondary">WAN Interface</div>
          <div className="font-mono text-text-primary">{tailscale.interface}</div>
        </div>
        <div className="bg-bg-card py-2">
          <div className="text-text-secondary">WAN RX</div>
          <div className="font-mono text-text-primary">{formatBytes(tailscale.rx_bytes)}</div>
        </div>
        <div className="bg-bg-card py-2">
          <div className="text-text-secondary">WAN TX</div>
          <div className="font-mono text-text-primary">{formatBytes(tailscale.tx_bytes)}</div>
        </div>
      </div>
    </div>
  );
}
