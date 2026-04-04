import { useState, useRef, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ArrowDown, ArrowUp, Activity, AlertTriangle, Globe, Radio } from 'lucide-react';
import type { StatusResponse } from '../api/types';
import { type DataPoint, type TimeWindow } from '../hooks/useNetHistory';
import { formatBytes, formatRate, formatPackets } from '../lib/utils';
import { cn } from '../lib/utils';

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

function TimeWindowSelector({ timeWindow, onChange }: { timeWindow: TimeWindow; onChange: (w: TimeWindow) => void }) {
  return (
    <div className="flex gap-1">
      {WINDOWS.map(w => (
        <button
          key={w.seconds}
          onClick={() => onChange(w.seconds)}
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
  );
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const rafRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.floor(width);
      const h = Math.floor(height);
      if (w > 0 && h > 0) setSize(s => (s.width === w && s.height === h) ? s : { width: w, height: h });
    };
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [ref]);

  return size;
}

function StatsChart({ data, rxKey, txKey, rxColor, txColor, rxGradId, txGradId }: {
  data: DataPoint[];
  rxKey: keyof DataPoint;
  txKey: keyof DataPoint;
  rxColor: string;
  txColor: string;
  rxGradId: string;
  txGradId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(containerRef);

  return (
    <div ref={containerRef} className="h-48 w-full">
      {data.length > 1 && width > 0 && height > 0 ? (
          <AreaChart width={width} height={height} data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={rxGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={rxColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={rxColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={txGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={txColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={txColor} stopOpacity={0} />
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
              dataKey={rxKey as string}
              stroke={rxColor}
              strokeWidth={1.5}
              fill={`url(#${rxGradId})`}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey={txKey as string}
              stroke={txColor}
              strokeWidth={1.5}
              fill={`url(#${txGradId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
      ) : data.length <= 1 ? (
        <div className="flex items-center justify-center h-full text-sm text-text-secondary">
          Collecting data... ({data.length} samples)
        </div>
      ) : null}
    </div>
  );
}

interface TrafficPanelProps {
  status: StatusResponse;
  data: DataPoint[];
  current: DataPoint;
  timeWindow: TimeWindow;
  onTimeWindowChange: (w: TimeWindow) => void;
}

export function BridgeTrafficPanel({ status, data, current, timeWindow, onTimeWindowChange }: TrafficPanelProps) {
  const { rvr_bridge } = status.network_stats;
  const { bridge_filter } = status;

  return (
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <h3 className="font-semibold">Bridge Traffic</h3>
            <span className="text-xs text-text-secondary">rvr_bridge</span>
          </div>
          <TimeWindowSelector timeWindow={timeWindow} onChange={onTimeWindowChange} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <StatTile
            icon={<ArrowDown className="w-4 h-4 text-emerald-400" />}
            label="RX Rate"
            value={formatRate(current.rx)}
            sub={`${formatBytes(rvr_bridge.rx_bytes)} total`}
            color="bg-emerald-500/10"
          />
          <StatTile
            icon={<ArrowUp className="w-4 h-4 text-blue-400" />}
            label="TX Rate"
            value={formatRate(current.tx)}
            sub={`${formatBytes(rvr_bridge.tx_bytes)} total`}
            color="bg-blue-500/10"
          />
          <StatTile
            icon={<Activity className="w-4 h-4 text-amber-400" />}
            label="Packet Rate"
            value={`${formatPackets(Math.round(current.pkts))}/s`}
            sub={`${formatPackets(rvr_bridge.rx_packets + rvr_bridge.tx_packets)} total`}
            color="bg-amber-500/10"
          />
          <StatTile
            icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
            label="Errors / Drops"
            value={`${rvr_bridge.rx_errors + rvr_bridge.tx_errors} / ${rvr_bridge.rx_dropped + rvr_bridge.tx_dropped}`}
            sub={bridge_filter.active ? `${formatPackets(bridge_filter.dropped_packets)} filtered` : 'Filter inactive'}
            color="bg-red-500/10"
          />
        </div>

        <div className="px-4 pb-2">
          <StatsChart
            data={data}
            rxKey="rx"
            txKey="tx"
            rxColor="#10b981"
            txColor="#3b82f6"
            rxGradId="bridgeRxGrad"
            txGradId="bridgeTxGrad"
          />
          <div className="flex items-center justify-center gap-6 py-2 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-500 rounded" /> RX
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-blue-500 rounded" /> TX
            </span>
          </div>
        </div>
      </div>
  );
}

export function WanTrafficPanel({ status, data, current, timeWindow, onTimeWindowChange }: TrafficPanelProps) {
  const wan = (status.network_stats as Record<string, unknown>).wan as typeof status.network_stats.wan
    ?? { interface: 'unknown', rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0 };

  return (
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold">WAN Traffic</h3>
            <span className="text-xs text-text-secondary">{wan.interface}</span>
          </div>
          <TimeWindowSelector timeWindow={timeWindow} onChange={onTimeWindowChange} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <StatTile
            icon={<ArrowDown className="w-4 h-4 text-violet-400" />}
            label="RX Rate"
            value={formatRate(current.wan_rx)}
            sub={`${formatBytes(wan.rx_bytes)} total`}
            color="bg-violet-500/10"
          />
          <StatTile
            icon={<ArrowUp className="w-4 h-4 text-orange-400" />}
            label="TX Rate"
            value={formatRate(current.wan_tx)}
            sub={`${formatBytes(wan.tx_bytes)} total`}
            color="bg-orange-500/10"
          />
          <StatTile
            icon={<Activity className="w-4 h-4 text-amber-400" />}
            label="Packets"
            value={formatPackets(wan.rx_packets + wan.tx_packets)}
            sub={`${formatPackets(wan.rx_packets)} rx / ${formatPackets(wan.tx_packets)} tx`}
            color="bg-amber-500/10"
          />
        </div>

        <div className="px-4 pb-2">
          <StatsChart
            data={data}
            rxKey="wan_rx"
            txKey="wan_tx"
            rxColor="#8b5cf6"
            txColor="#f97316"
            rxGradId="wanRxGrad"
            txGradId="wanTxGrad"
          />
          <div className="flex items-center justify-center gap-6 py-2 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-violet-500 rounded" /> RX
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-orange-500 rounded" /> TX
            </span>
          </div>
        </div>
      </div>
  );
}

