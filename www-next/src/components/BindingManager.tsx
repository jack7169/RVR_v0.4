import { useEffect, useState, useCallback, useRef } from 'react';
import type { DiscoveredPeer, PeerDiscovery, AircraftProfiles, LinkSettings } from '../api/types';
import {
  discoverPeers, listAircraft, bindAircraft, unbindAircraft,
  connectAircraft, setActiveAircraft, addPeerIp,
  getLinkSettings, updateLinkSettings,
} from '../api/client';
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
          } else {
            toast('Setup finished with errors', 'error');
          }
          onSuccess();
        }
      } catch { /* ignore */ }
    }, 3000);
  };

  const handleBind = async (pass?: string) => {
    if (!peer || !name.trim()) { toast('Aircraft name is required', 'error'); return; }
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
          <pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs font-mono text-text-secondary max-h-64 overflow-y-auto whitespace-pre-wrap">
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
  peer, selfVersion, onBind, onReconnect,
}: {
  peer: DiscoveredPeer; selfVersion?: string; onBind: () => void; onReconnect: () => void;
}) {
  const isOnline = peer.connection_mode === 'online';
  const modeColor = isOnline ? 'text-success'
    : peer.connection_mode === 'stale' ? 'text-warning'
    : 'text-text-secondary';
  const versionMismatch = selfVersion && peer.git_version && peer.git_version !== 'unknown'
    && selfVersion !== peer.git_version;

  return (
    <div className={cn(
      'bg-bg-card border rounded-xl p-4 flex flex-col gap-2',
      peer.is_self ? 'border-accent/30' : 'border-border',
      versionMismatch && 'border-warning/40',
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

      {versionMismatch && (
        <div className="text-xs text-warning bg-warning/10 rounded px-2 py-1">
          Version mismatch: {peer.git_version?.slice(0, 7)} (this device: {selfVersion?.slice(0, 7)})
        </div>
      )}

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

const FIELD_LABELS: Record<keyof LinkSettings, { label: string; tooltip: string }> = {
  kcp_nodelay: { label: 'No Delay', tooltip: '1=no ACK delay (recommended)' },
  kcp_interval: { label: 'Interval (ms)', tooltip: 'Internal update interval. Lower=more responsive, higher CPU' },
  kcp_resend: { label: 'Resend Threshold', tooltip: 'Retransmit after N missed ACKs. 4=good for Starlink drops' },
  kcp_nc: { label: 'No Congestion', tooltip: '1=disable congestion control (recommended for dedicated links)' },
  kcp_segment_mtu: { label: 'Segment MTU', tooltip: 'KCP segment size. 1200 fits Tailscale 1280 limit' },
  kcp_sndwnd: { label: 'Send Window', tooltip: 'Send window size in packets' },
  kcp_rcvwnd: { label: 'Recv Window', tooltip: 'Receive window size in packets' },
  kcp_sockbuf: { label: 'Socket Buffer', tooltip: 'Kernel socket buffer size (bytes)' },
  kcp_smuxbuf: { label: 'Smux Buffer', tooltip: 'Smux overall buffer size (bytes)' },
  kcp_streambuf: { label: 'Stream Buffer', tooltip: 'Per-stream buffer size (bytes)' },
  bridge_mtu: { label: 'Bridge MTU', tooltip: 'L2 bridge interface MTU. 1500=standard Ethernet' },
};

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

  const handleSave = async () => {
    if (!hasChanges) return;
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
      <div className="mb-3 flex gap-2 flex-wrap">
        <span className="text-xs text-text-secondary self-center">Presets:</span>
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
        {(Object.keys(FIELD_LABELS) as (keyof LinkSettings)[]).map(field => (
          <div key={field} className="flex items-center justify-between gap-2 py-1">
            <label className="text-xs text-text-secondary" title={FIELD_LABELS[field].tooltip}>
              {FIELD_LABELS[field].label}
            </label>
            <input
              type="number"
              value={current[field]}
              onChange={e => handleChange(field, e.target.value)}
              className={cn(
                'w-28 bg-bg-input border rounded px-2 py-1 text-xs text-right font-mono text-text-primary',
                edited[field] !== undefined ? 'border-accent' : 'border-border',
              )}
            />
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

  const filteredPeers = discovery?.peers.filter(p => {
    if (filter === 'online') return p.connection_mode === 'online';
    if (filter === 'unbound') return !p.is_bound;
    return true;
  }) ?? [];

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
            if (!manualIp) return;
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

        {/* Self node */}
        {discovery?.self && (
          <div className="mb-3">
            <PeerCard peer={discovery.self} selfVersion={discovery.self.git_version} onBind={() => {}} onReconnect={() => {}} />
          </div>
        )}

        {/* Peer grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredPeers.map(peer => (
            <PeerCard
              key={peer.ip}
              peer={peer}
              selfVersion={discovery?.self.git_version}
              onBind={() => setBindPeer(peer)}
              onReconnect={() => {
                if (peer.bound_profile_id) handleReconnect(peer.bound_profile_id);
              }}
            />
          ))}
        </div>

        {filteredPeers.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-6">
            {filter === 'all' ? 'No Tailscale peers found' : `No ${filter} peers`}
          </p>
        )}
      </Card>

      {/* Bound Aircraft */}
      <Card title="Bound Aircraft" badge={
        <span className="text-xs text-text-secondary">
          {profiles ? Object.keys(profiles.profiles).length : 0} profiles
        </span>
      }>
        {profiles && Object.keys(profiles.profiles).length > 0 ? (
          <div className="divide-y divide-border">
            {Object.entries(profiles.profiles).map(([id, profile]) => {
              const isActive = profiles.active === id;
              const peer = discovery?.peers.find(p => p.ip === profile.tailscale_ip);

              return (
                <div key={id} className={cn(
                  'flex items-center justify-between py-3 gap-3',
                  isActive && 'bg-accent/5 -mx-4 px-4 rounded-lg',
                )}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{profile.name}</span>
                      {isActive && <Badge variant="success">Active</Badge>}
                      {peer && (
                        <span className={cn('w-2 h-2 rounded-full', peer.connection_mode === 'online' ? 'bg-success' : 'bg-error/50')} />
                      )}
                    </div>
                    <div className="text-xs text-text-secondary font-mono">{profile.tailscale_ip}</div>
                    {peer && peer.connection_mode !== 'offline' && (
                      <div className="text-xs text-text-secondary">
                        {peer.connection_mode}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {!isActive && (
                      <Button size="sm" variant="ghost" onClick={() => handleSetActive(id)}>Activate</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleReconnect(id)}>Connect</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(id)}>Remove</Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
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
