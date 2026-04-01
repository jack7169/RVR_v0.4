import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ArrowDown, ArrowUp, Activity, AlertTriangle, Globe, Radio } from 'lucide-react';
import type { StatusResponse } from '../api/types';
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

function StatsChart({ data, rxKey, txKey, rxColor, txColor, rxGradId, txGradId }: {
  data: DataPoint[];
  rxKey: keyof DataPoint;
  txKey: keyof DataPoint;
  rxColor: string;
  txColor: string;
  rxGradId: string;
  txGradId: string;
}) {
  return (
    <div className="h-48 w-full">
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
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
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-text-secondary">
          Collecting data... ({data.length} samples)
        </div>
      )}
    </div>
  );
}

export function NetworkStats({ status }: Props) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(60);
  const { getWindow, current, revision } = useNetHistory(status);
  const { rvr_bridge, wan } = status.network_stats;
  const { bridge_filter } = status;

  void revision;
  const data = getWindow(timeWindow);

  return (
    <div className="space-y-4">
      {/* RVR Bridge Panel */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <h3 className="font-semibold">Bridge Traffic</h3>
            <span className="text-xs text-text-secondary">rvr_bridge</span>
          </div>
          <TimeWindowSelector timeWindow={timeWindow} onChange={setTimeWindow} />
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

      {/* WAN Panel */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold">WAN Traffic</h3>
            <span className="text-xs text-text-secondary">{wan.interface}</span>
          </div>
          <TimeWindowSelector timeWindow={timeWindow} onChange={setTimeWindow} />
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
          <StatTile
            icon={<Radio className="w-4 h-4 text-emerald-400" />}
            label="Overhead"
            value={(() => {
              const bridgeTotal = current.rx + current.tx;
              const wanTotal = current.wan_rx + current.wan_tx;
              if (bridgeTotal === 0 || wanTotal === 0) return '—';
              const ratio = ((wanTotal - bridgeTotal) / bridgeTotal) * 100;
              return `${ratio > 0 ? '+' : ''}${ratio.toFixed(0)}%`;
            })()}
            sub="WAN vs Bridge"
            color="bg-emerald-500/10"
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
    </div>
  );
}
