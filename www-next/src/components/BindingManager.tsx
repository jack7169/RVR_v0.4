import { useEffect, useState, useCallback, useRef } from 'react';
import type { DiscoveredPeer, PeerDiscovery, AircraftProfiles, LinkSettings } from '../api/types';
import {
  discoverPeers, listAircraft, bindAircraft, unbindAircraft,
  connectAircraft, setActiveAircraft, addPeerIp,
  getLinkSettings, updateLinkSettings, fetchLinkProfile, updateLinkProfile,
} from '../api/client';
import { linkSettingsSchema, aircraftNameSchema, vpnIpSchema } from '../lib/schemas';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';
import { cn, formatBytes } from '../lib/utils';

interface Props {
  onRefresh: () => void;
}

type Filter = 'all' | 'online' | 'unbound';

// ── Bind Modal ────────────────────────────────────────────────────────

function BindModal({
  peer, open, onClose, onSuccess,
}: {
  peer: DiscoveredPeer | null; open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');
  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    if (peer) {
      setName(peer.hostname);
      setPassword('');
      setNeedsPassword(false);
      setRunning(false);
      setOutput('');
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [peer]);

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const logRes = await fetch('/cgi-bin/api.cgi?action=setup_log');
        if (!logRes.ok) return;
        const data = await logRes.json() as { log?: string };
        if (data.log) setOutput(data.log);
        if (data.log?.includes('[BIND COMPLETE]')) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
          if (data.log.includes('exit_code=0')) {
            toast('Aircraft bound successfully!', 'success');
            onSuccess();
          } else {
            toast('Setup finished with errors — check log output', 'error');
          }
        }
      } catch { /* ignore */ }
    }, 1000);
  };

  const handleBind = async (pass?: string) => {
    const nameResult = aircraftNameSchema.safeParse(name.trim());
    if (!peer || !nameResult.success) {
      toast(nameResult.success ? 'Aircraft name is required' : nameResult.error.issues[0].message, 'error');
      return;
    }
    setRunning(true);
    setNeedsPassword(false);
    setOutput('Connecting to ' + peer.ip + '...\n');
    try {
      const res = await bindAircraft(peer.ip, name, pass || password);
      if (res.needs_password) {
        setRunning(false);
        setNeedsPassword(true);
        setOutput('');
        return;
      }
      if (res.success) {
        setOutput('Setup running — installing packages, configuring bridge, starting services...\n');
        startPolling();
      } else {
        setOutput('ERROR: ' + (res.error || 'Bind failed') + '\n');
        toast(res.error || 'Bind failed', 'error');
        setRunning(false);
      }
    } catch {
      toast('Failed to start binding', 'error');
      setRunning(false);
    }
  };

  if (!peer) return null;

  return (
    <Modal open={open} onClose={running ? () => {} : onClose} title={`Bind ${peer.hostname}`} wide>
      <div className="space-y-4">
        {/* Name + IP (always visible) */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-text-secondary mb-1">Aircraft Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Aircraft Alpha"
              disabled={running}
              autoFocus={!running && !needsPassword}
              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary disabled:opacity-50"
              onKeyDown={e => !running && !needsPassword && e.key === 'Enter' && handleBind()}
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-text-secondary mb-1">VPN IP</label>
            <div className="font-mono text-sm text-text-secondary bg-bg-primary border border-border rounded-lg px-3 py-2">
              {peer.ip}
            </div>
          </div>
        </div>

        {/* Password prompt — only shown if SSH key auth failed */}
        {needsPassword && (
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 space-y-3">
            <p className="text-sm text-warning">
              SSH key not installed on this aircraft. Enter the root password for first-time setup.
            </p>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Root password"
              autoFocus
              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
              onKeyDown={e => e.key === 'Enter' && password && handleBind(password)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={() => handleBind(password)} disabled={!password}>
                Continue Setup
              </Button>
            </div>
          </div>
        )}

        {/* Setup log output */}
        {output && (
          <pre ref={logRef} className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono text-text-secondary max-h-64 overflow-y-auto whitespace-pre-wrap">
            {output}
          </pre>
        )}

        {/* Running spinner */}
        {running && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
            Setup in progress — this takes ~2 minutes
          </div>
        )}

        {/* Action buttons (when not running and not prompting for password) */}
        {!running && !needsPassword && !output && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => handleBind()}>
              Bind Aircraft
            </Button>
          </div>
        )}

        {/* Close button after completion */}
        {!running && output && !needsPassword && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Peer Card ─────────────────────────────────────────────────────────

function PeerCard({
  peer, selfVersion, selfBranch, onBind, onReconnect,
}: {
  peer: DiscoveredPeer; selfVersion?: string; selfBranch?: string; onBind: () => void; onReconnect: () => void;
}) {
  const isOnline = peer.connection_mode === 'online';
  const modeColor = isOnline ? 'text-success'
    : peer.connection_mode === 'stale' ? 'text-warning'
    : 'text-text-secondary';
  const versionMismatch = selfVersion && peer.git_version && peer.git_version !== 'unknown'
    && selfVersion !== peer.git_version;
  const branchMismatch = selfBranch && peer.git_branch && peer.git_branch !== selfBranch;
  const peerBranch = peer.git_branch || 'main';
  const isDevBranch = peerBranch !== 'main';

  return (
    <div className={cn(
      'bg-bg-card border rounded-xl p-4 flex flex-col gap-2',
      peer.is_self ? 'border-accent/30' : 'border-border',
      branchMismatch ? 'border-error/40' : versionMismatch && 'border-warning/40',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn(
            'w-2.5 h-2.5 rounded-full',
            isOnline ? 'bg-success' : peer.connection_mode === 'stale' ? 'bg-warning' : 'bg-error/50',
          )} />
          <span className="font-medium text-sm">{peer.hostname}</span>
          {peer.is_self && <Badge variant="info">This Device</Badge>}
        </div>
        {peer.role !== 'unknown' && (
          <Badge variant={peer.role === 'gcs' ? 'info' : 'neutral'}>
            {peer.role === 'gcs' ? 'GCS' : 'Aircraft'}
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-text-secondary">{peer.ip}</span>
        <span className={modeColor}>{peer.connection_mode}</span>
      </div>

      <div className="flex items-center justify-between text-xs">
        {peer.git_version && peer.git_version !== 'unknown' ? (
          <span className={cn(
            'font-mono',
            branchMismatch ? 'text-error' : versionMismatch ? 'text-warning' : 'text-success',
          )}>
            <span className={isDevBranch ? 'text-accent' : undefined}>{peerBranch}</span>:{peer.git_version.slice(0, 7)}
          </span>
        ) : (
          <span className="font-mono text-text-secondary/50">version unknown</span>
        )}
        {branchMismatch ? (
          <span className="text-error">branch mismatch</span>
        ) : versionMismatch ? (
          <span className="text-warning">mismatch</span>
        ) : null}
      </div>

      {(peer.wg_rx_bytes > 0 || peer.wg_tx_bytes > 0) && (
        <div className="text-xs text-text-secondary">
          RX: {formatBytes(peer.wg_rx_bytes)} / TX: {formatBytes(peer.wg_tx_bytes)}
        </div>
      )}

      {!peer.is_self && (
        <div className="mt-1">
          {peer.is_bound ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-success flex items-center gap-1">
                Bound: {peer.bound_profile_name}
              </span>
              <Button size="sm" variant="ghost" onClick={onReconnect}>Reconnect</Button>
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={onBind} disabled={peer.connection_mode === 'offline'}>
              Bind
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Link Settings Panel ───────────────────────────────────────────────

const PRESETS: Record<string, Partial<LinkSettings>> = {
  'Starlink Optimized': {
    kcp_nodelay: 1, kcp_interval: 20, kcp_resend: 4, kcp_nc: 1,
    kcp_segment_mtu: 1200, kcp_sndwnd: 1024, kcp_rcvwnd: 1024,
    kcp_sockbuf: 8388608, kcp_smuxbuf: 8388608, kcp_streambuf: 2097152, bridge_mtu: 1500,
  },
};

const FIELD_HELP: Record<keyof LinkSettings, { label: string; help: string }> = {
  kcp_nodelay: {
    label: 'No Delay',
    help: 'Controls ACK delay behavior. 1=send ACKs immediately (recommended for low latency). 0=delayed ACKs (saves bandwidth at cost of responsiveness). Keep at 1 for satellite links.',
  },
  kcp_interval: {
    label: 'Interval (ms)',
    help: 'Internal KCP update interval in milliseconds. Controls how often the protocol checks for retransmits and sends data. Lower=more responsive but higher CPU. 10ms=aggressive, 20ms=balanced (default), 50ms=conservative. Starlink: 20ms handles 100-500ms drops well.',
  },
  kcp_resend: {
    label: 'Resend Threshold',
    help: 'Fast retransmit after N missed ACKs. When this many ACKs are skipped for a packet, it is retransmitted without waiting for the timeout. 2=aggressive retransmit, 4=balanced (default for Starlink — waits ~80ms before retransmit, rides out brief drops). Higher values reduce unnecessary retransmits on lossy links.',
  },
  kcp_nc: {
    label: 'No Congestion',
    help: 'Congestion control toggle. 1=disabled (recommended for dedicated links where you control the bandwidth). 0=enabled (throttles sending rate when loss detected — useful on shared networks). For Starlink with a single aircraft, disable congestion control.',
  },
  kcp_segment_mtu: {
    label: 'Segment MTU',
    help: 'Maximum size of a single KCP segment in bytes. Must fit within the VPN tunnel MTU. Default 1200 fits within Tailscale/WireGuard 1280-byte MTU with overhead. Increasing may improve throughput but risks fragmentation. Do not exceed 1400.',
  },
  kcp_sndwnd: {
    label: 'Send Window',
    help: 'Send window size in packets. Limits how many unacknowledged packets can be in flight. Larger windows allow higher throughput on high-latency links. 1024=good for Starlink (40-60ms RTT). Reduce if experiencing congestion, increase for higher bandwidth links.',
  },
  kcp_rcvwnd: {
    label: 'Recv Window',
    help: 'Receive window size in packets. Should generally match send window. Controls how many out-of-order packets the receiver will buffer. 1024=default. Must be equal to or larger than send window for full throughput.',
  },
  kcp_sockbuf: {
    label: 'Socket Buffer',
    help: 'Kernel TCP socket buffer size in bytes for the local kcptun connection. 8MB (8388608) default. Larger buffers prevent kernel-level drops during bursts. Reduce only if RAM is critically constrained.',
  },
  kcp_smuxbuf: {
    label: 'Smux Buffer',
    help: 'Smux multiplexer overall buffer size in bytes. Controls how much data can be buffered across ALL streams combined. 8MB default. This is the total buffer shared by all tap2tcp streams through the tunnel.',
  },
  kcp_streambuf: {
    label: 'Stream Buffer',
    help: 'Per-stream buffer size in bytes within the smux multiplexer. Each tap2tcp flow (MAC pair direction) gets its own stream with this buffer. 2MB default. Larger buffers help absorb bursts from individual devices (e.g., camera video). Total memory = streambuf x active_streams.',
  },
  bridge_mtu: {
    label: 'Bridge MTU',
    help: 'L2 bridge interface MTU in bytes. 1500=standard Ethernet (default). Must match what bridged devices expect. Cameras and most network equipment use 1500. Only change if you have specific MTU requirements on your LAN.',
  },
};

const LINK_PRESETS: Record<string, { up: number; down: number; lat: number }> = {
  'Starlink Direct': { up: 15, down: 150, lat: 2000 },
  'Relay (DERP)': { up: 5, down: 5, lat: 2000 },
};

function LinkProfileSection() {
  const [profile, setProfile] = useState({ upload_mbps: 15, download_mbps: 150, latency_budget_ms: 2000 });
  const [applying, setApplying] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchLinkProfile().then(p => setProfile({ upload_mbps: p.upload_mbps, download_mbps: p.download_mbps, latency_budget_ms: p.latency_budget_ms })).catch(() => {});
  }, []);

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await updateLinkProfile(profile.upload_mbps, profile.download_mbps, profile.latency_budget_ms);
      if (res.success) {
        toast('Link profile applied — buffers resized, kcptun restarted', 'success');
      } else {
        toast(res.error || 'Failed to apply', 'error');
      }
    } catch { toast('Failed', 'error'); }
    finally { setApplying(false); }
  };

  return (
    <div className="mb-4 pb-4 border-b border-border">
      <div className="text-xs font-semibold text-text-secondary mb-2">Link Profile</div>
      <div className="flex gap-2 mb-2 flex-wrap">
        {Object.entries(LINK_PRESETS).map(([name, p]) => (
          <button
            key={name}
            onClick={() => setProfile({ upload_mbps: p.up, download_mbps: p.down, latency_budget_ms: p.lat })}
            className="text-xs bg-border/30 hover:bg-border/50 px-2 py-1 rounded transition-colors"
          >
            {name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-text-secondary">Upload (Mbps)</label>
          <input type="number" value={profile.upload_mbps} onChange={e => setProfile(p => ({ ...p, upload_mbps: Number(e.target.value) }))}
            className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono text-text-primary" />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary">Download (Mbps)</label>
          <input type="number" value={profile.download_mbps} onChange={e => setProfile(p => ({ ...p, download_mbps: Number(e.target.value) }))}
            className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono text-text-primary" />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary">Latency Budget (ms)</label>
          <input type="number" value={profile.latency_budget_ms} onChange={e => setProfile(p => ({ ...p, latency_budget_ms: Number(e.target.value) }))}
            className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono text-text-primary" />
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-secondary">
          Buffers auto-computed: ~{Math.round(profile.upload_mbps * 1000000 / 8 * profile.latency_budget_ms / 1000 / 4 / 1024)}KB per stage
        </span>
        <Button size="sm" variant="primary" onClick={handleApply} loading={applying}>Apply Profile</Button>
      </div>
    </div>
  );
}

function LinkSettingsPanel({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<LinkSettings | null>(null);
  const [edited, setEdited] = useState<Partial<LinkSettings>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await getLinkSettings();
      setSettings(data);
      setEdited({});
    } catch {
      // Settings may not exist yet
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const current = settings ? { ...settings, ...edited } : null;
  const hasChanges = Object.keys(edited).length > 0;

  const handleChange = (field: keyof LinkSettings, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setEdited(prev => ({ ...prev, [field]: num }));
    }
  };

  const handlePreset = (name: string) => {
    const preset = PRESETS[name];
    if (preset) setEdited(preset);
  };

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSave = async () => {
    if (!hasChanges || !current) return;
    // Validate all fields
    const result = linkSettingsSchema.safeParse(current);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach(issue => {
        const field = issue.path[0] as string;
        fieldErrors[field] = issue.message;
      });
      setErrors(fieldErrors);
      toast('Invalid settings — check highlighted fields', 'error');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await updateLinkSettings(edited, true);
      if (res.success) {
        toast('Link settings updated', 'success');
        load();
      } else {
        toast(res.error || 'Save failed', 'error');
      }
    } catch {
      toast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!current) {
    return (
      <Card title="Link Settings">
        <p className="text-sm text-text-secondary py-4">Loading settings...</p>
      </Card>
    );
  }

  return (
    <Card title="Link Settings" badge={hasChanges ? <Badge variant="warning">Unsaved</Badge> : undefined}>
      <LinkProfileSection />

      <div className="mb-3 flex gap-2 flex-wrap">
        <span className="text-xs text-text-secondary self-center">KCPtun Presets:</span>
        {Object.keys(PRESETS).map(name => (
          <button
            key={name}
            onClick={() => handlePreset(name)}
            className="text-xs bg-border/30 hover:bg-border/50 px-2 py-1 rounded transition-colors"
          >
            {name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {(Object.keys(FIELD_HELP) as (keyof LinkSettings)[]).map(field => (
          <div key={field} className="flex items-center justify-between gap-2 py-1 group/field relative">
            <label className="text-xs text-text-secondary flex items-center gap-1 cursor-help">
              {FIELD_HELP[field].label}
              <span className="text-text-secondary/40 group-hover/field:text-accent transition-colors">?</span>
            </label>
            <div className="hidden group-hover/field:block absolute left-0 bottom-full mb-1 z-50 w-72 bg-bg-secondary border border-border rounded-lg p-3 shadow-xl text-xs text-text-secondary leading-relaxed">
              <div className="font-medium text-text-primary mb-1">{FIELD_HELP[field].label}</div>
              {FIELD_HELP[field].help}
            </div>
            <div className="flex flex-col items-end">
              <input
                type="number"
                value={current[field]}
                onChange={e => { handleChange(field, e.target.value); setErrors(prev => { const n = {...prev}; delete n[field]; return n; }); }}
                className={cn(
                  'w-28 bg-bg-input border rounded px-2 py-1 text-xs text-right font-mono text-text-primary',
                  errors[field] ? 'border-error' : edited[field] !== undefined ? 'border-accent' : 'border-border',
                )}
              />
              {errors[field] && <span className="text-[10px] text-error mt-0.5">{errors[field]}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        {hasChanges && (
          <Button size="sm" variant="ghost" onClick={() => setEdited({})}>Reset</Button>
        )}
        <Button size="sm" variant="primary" onClick={handleSave} loading={saving} disabled={!hasChanges}>
          Save & Restart
        </Button>
      </div>
    </Card>
  );
}

// ── Main Binding Manager ──────────────────────────────────────────────

export function BindingManager({ onRefresh }: Props) {
  const [discovery, setDiscovery] = useState<PeerDiscovery | null>(null);
  const [profiles, setProfiles] = useState<AircraftProfiles | null>(null);
  const [filter, setFilter] = useState<Filter>('online');
  const [bindPeer, setBindPeer] = useState<DiscoveredPeer | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualIp, setManualIp] = useState('');
  const [settingsKey, setSettingsKey] = useState(0);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    try {
      const [disc, profs] = await Promise.all([discoverPeers(), listAircraft()]);
      setDiscovery(disc);
      setProfiles(profs);
    } catch {
      // May fail if services not running
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleReconnect = async (profileId: string) => {
    try {
      const res = await connectAircraft(profileId);
      if (res.success) {
        toast('Reconnecting...', 'success');
        onRefresh();
      } else {
        toast(res.error || 'Failed', 'error');
      }
    } catch {
      toast('Reconnect failed', 'error');
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      await setActiveAircraft(id);
      toast('Aircraft activated', 'success');
      loadData();
      onRefresh();
    } catch {
      toast('Failed to activate', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await unbindAircraft(id);
      toast('Aircraft unbound', 'success');
      loadData();
      onRefresh();
    } catch {
      toast('Unbind failed', 'error');
    }
  };

  const filteredPeers = (discovery?.peers.filter(p => {
    if (p.is_self) return false;
    if (filter === 'online') return p.connection_mode === 'online';
    if (filter === 'unbound') return !p.is_bound;
    return true;
  }) ?? []).sort((a, b) => {
    // Online first, then alphabetical by hostname, then by IP
    if (a.connection_mode === 'online' && b.connection_mode !== 'online') return -1;
    if (a.connection_mode !== 'online' && b.connection_mode === 'online') return 1;
    if (a.hostname !== 'unknown' && b.hostname === 'unknown') return -1;
    if (a.hostname === 'unknown' && b.hostname !== 'unknown') return 1;
    return a.ip.localeCompare(b.ip);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-8 h-8 border-3 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Network Discovery */}
      <Card title="Network Discovery" badge={
        <span className="text-xs text-text-secondary">{discovery?.peers.length ?? 0} peers</span>
      }>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex gap-2">
            {(['all', 'online', 'unbound'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'text-xs px-3 py-1 rounded-full transition-colors',
                  filter === f
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'bg-border/20 text-text-secondary hover:text-text-primary',
                )}
              >
                {f === 'all' ? 'All' : f === 'online' ? 'Online' : 'Unbound'}
              </button>
            ))}
          </div>
          <form className="flex gap-1" onSubmit={async (e) => {
            e.preventDefault();
            const ipResult = vpnIpSchema.safeParse(manualIp);
            if (!ipResult.success) { toast(ipResult.error.issues[0].message, 'error'); return; }
            try {
              await addPeerIp(manualIp);
              toast('Peer added, refreshing...', 'success');
              setManualIp('');
              loadData();
            } catch { toast('Failed to add peer', 'error'); }
          }}>
            <input
              value={manualIp}
              onChange={e => setManualIp(e.target.value)}
              placeholder="100.x.x.x"
              className="w-32 bg-bg-input border border-border rounded-lg px-2 py-1 text-xs font-mono text-text-primary"
            />
            <Button size="sm" variant="ghost" type="submit">Add Peer</Button>
          </form>
        </div>

        {/* Peer grid (includes self, formatted consistently) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {discovery?.self && (
            <PeerCard peer={discovery.self} selfVersion={discovery.self.git_version} selfBranch={discovery.self.git_branch} onBind={() => {}} onReconnect={() => {}} />
          )}
          {filteredPeers.map(peer => (
            <PeerCard
              key={peer.ip}
              peer={peer}
              selfVersion={discovery?.self.git_version}
              selfBranch={discovery?.self.git_branch}
              onBind={() => setBindPeer(peer)}
              onReconnect={() => {
                if (peer.bound_profile_id) handleReconnect(peer.bound_profile_id);
              }}
            />
          ))}
        </div>

        {filteredPeers.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-6">
            {filter === 'all'
              ? 'No VPN peers found. Check that Tailscale/WireGuard is running.'
              : filter === 'online'
              ? `No peers online. ${(discovery?.peers.length ?? 0)} peers discovered but all offline. Try "All" filter.`
              : 'No unbound peers found.'}
          </p>
        )}
      </Card>

      {/* Active Binding — side-by-side GCS <-> Aircraft */}
      <Card title="Active Binding">
        {profiles && profiles.active && profiles.profiles[profiles.active] ? (() => {
          const activeProfile = profiles.profiles[profiles.active];
          const aircraftPeer = discovery?.peers.find(p => p.ip === activeProfile.tailscale_ip);
          const selfPeer = discovery?.self;
          const isOnline = aircraftPeer?.connection_mode === 'online';

          return (
            <div>
              {/* Side-by-side connection display */}
              <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                {/* GCS side */}
                <div className="bg-bg-primary rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-success" />
                    <span className="font-medium text-sm">{selfPeer?.hostname || 'GCS'}</span>
                    <Badge variant="info">GCS</Badge>
                  </div>
                  <div className="text-xs font-mono text-text-secondary">{selfPeer?.ip || '—'}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-success">online</span>
                    {selfPeer?.git_version && selfPeer.git_version !== 'unknown' && (
                      <span className="text-xs font-mono text-text-secondary">
                        {selfPeer.git_branch && selfPeer.git_branch !== 'main' && <span className="text-accent">{selfPeer.git_branch}:</span>}
                        {selfPeer.git_version.slice(0, 7)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Connection indicator */}
                <div className="flex flex-col items-center gap-1 px-2">
                  <div className={cn(
                    'w-16 h-0.5 rounded-full',
                    isOnline ? 'bg-success' : 'bg-error/50',
                  )} />
                  <span className={cn(
                    'text-[10px] font-medium',
                    isOnline ? 'text-success' : 'text-error',
                  )}>
                    {isOnline ? 'LINKED' : 'DOWN'}
                  </span>
                  <div className={cn(
                    'w-16 h-0.5 rounded-full',
                    isOnline ? 'bg-success' : 'bg-error/50',
                  )} />
                </div>

                {/* Aircraft side */}
                <div className="bg-bg-primary rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn('w-2.5 h-2.5 rounded-full', isOnline ? 'bg-success' : 'bg-error/50')} />
                    <span className="font-medium text-sm">{activeProfile.name}</span>
                    <Badge variant="neutral">Aircraft</Badge>
                  </div>
                  <div className="text-xs font-mono text-text-secondary">{activeProfile.tailscale_ip}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={cn('text-xs', isOnline ? 'text-success' : 'text-error')}>
                      {aircraftPeer?.connection_mode || 'unknown'}
                    </span>
                    {aircraftPeer?.git_version && aircraftPeer.git_version !== 'unknown' && (
                      <span className="text-xs font-mono text-text-secondary">
                        {aircraftPeer.git_branch && aircraftPeer.git_branch !== 'main' && <span className="text-accent">{aircraftPeer.git_branch}:</span>}
                        {aircraftPeer.git_version.slice(0, 7)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Branch mismatch warning (more severe) */}
              {selfPeer?.git_branch && aircraftPeer?.git_branch
                && selfPeer.git_branch !== aircraftPeer.git_branch && (
                <div className="mt-3 bg-error/10 border border-error/30 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-error">
                    Branch mismatch: GCS on <code>{selfPeer.git_branch}</code>, Aircraft on <code>{aircraftPeer.git_branch}</code>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="danger" onClick={() => {
                      import('../api/client').then(({ updateRemote }) => {
                        updateRemote(activeProfile.tailscale_ip, selfPeer!.git_branch);
                      });
                    }}>
                      Sync Aircraft
                    </Button>
                  </div>
                </div>
              )}

              {/* Version mismatch warning */}
              {selfPeer?.git_version && aircraftPeer?.git_version
                && selfPeer.git_version !== 'unknown' && aircraftPeer.git_version !== 'unknown'
                && selfPeer.git_version !== aircraftPeer.git_version
                && selfPeer.git_branch === aircraftPeer?.git_branch && (
                <div className="mt-3 bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-warning">
                    Version mismatch: GCS <code>{selfPeer.git_version.slice(0, 7)}</code> ≠ Aircraft <code>{aircraftPeer.git_version.slice(0, 7)}</code>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="warning" onClick={() => {
                      import('../api/client').then(({ updateRemote }) => {
                        updateRemote(activeProfile.tailscale_ip);
                      });
                    }}>
                      Update Aircraft
                    </Button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-center gap-2 mt-3">
                <Button size="sm" variant="ghost" onClick={() => handleReconnect(profiles.active)}>Reconnect</Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(profiles.active)}>Unbind</Button>
              </div>

              {/* Other profiles (if any) */}
              {Object.keys(profiles.profiles).length > 1 && (
                <div className="mt-4 pt-3 border-t border-border">
                  <div className="text-xs text-text-secondary mb-2">Other Profiles</div>
                  {Object.entries(profiles.profiles).filter(([id]) => id !== profiles.active).map(([id, profile]) => {
                    const peer = discovery?.peers.find(p => p.ip === profile.tailscale_ip);
                    return (
                      <div key={id} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full', peer?.connection_mode === 'online' ? 'bg-success' : 'bg-error/50')} />
                          <span className="text-sm">{profile.name}</span>
                          <span className="text-xs font-mono text-text-secondary">{profile.tailscale_ip}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleSetActive(id)}>Activate</Button>
                          <Button size="sm" variant="danger" onClick={() => handleDelete(id)}>Remove</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })() : (
          <p className="text-sm text-text-secondary text-center py-6">
            No aircraft bound. Use Network Discovery above to bind one.
          </p>
        )}
      </Card>

      {/* Link Settings */}
      <LinkSettingsPanel refreshKey={settingsKey} />

      {/* Bind Modal */}
      <BindModal
        peer={bindPeer}
        open={bindPeer !== null}
        onClose={() => setBindPeer(null)}
        onSuccess={() => { setBindPeer(null); loadData(); setSettingsKey(k => k + 1); onRefresh(); }}
      />
    </div>
  );
}
