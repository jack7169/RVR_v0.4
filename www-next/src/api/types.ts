export interface StatusResponse {
  timestamp: string;
  role: 'gcs' | 'aircraft' | 'unknown';
  gcs: {
    tailscale_ip: string;
    tailscale_status: 'connected' | 'disconnected';
    services: {
      kcptun_server: 'running' | 'stopped';
      tap2tcp: 'running' | 'stopped';
      rvr_bridge_interface: 'up' | 'down';
    };
    interface: {
      name: string;
      mtu: number;
      state: 'up' | 'down';
    };
    tap2tcp_streams: {
      active: number;
      max: number;
      flows: number;
      broadcast_stream: 'up' | 'down';
      tap_rx_frames: number;
      tap_rx_bytes: number;
      tap_tx_frames: number;
      tap_tx_bytes: number;
      soft_drops: number;
      hard_drops: number;
      seq_drops: number;
    };
    watchdog: 'active' | 'inactive';
    health: {
      status: 'OK' | 'ERROR' | 'RECOVERING' | 'unknown';
      last_check: string;
      details: string;
    };
  };
  aircraft: {
    id: string;
    profile_name: string;
    tailscale_ip: string;
    reachable: boolean;
    tailscale_peer: {
      mode: 'direct' | 'relay' | 'idle' | 'unknown';
      relay: string;
      rx_bytes: number;
      tx_bytes: number;
    };
    services: {
      kcptun_client: 'running' | 'stopped' | 'unknown';
      tap2tcp: 'running' | 'stopped' | 'unknown';
      rvr_bridge_interface: 'up' | 'down' | 'unknown';
    };
  };
  connection: {
    established: boolean;
    duration_seconds: number;
  };
  network_stats: {
    timestamp_ms: number;
    rvr_bridge: {
      rx_bytes: number;
      tx_bytes: number;
      rx_packets: number;
      tx_packets: number;
      rx_errors: number;
      tx_errors: number;
      rx_dropped: number;
      tx_dropped: number;
      multicast: number;
    };
    tailscale: {
      interface: string;
      rx_bytes: number;
      tx_bytes: number;
      rx_packets: number;
      tx_packets: number;
    };
  };
  internet: {
    status: 'connected' | 'disconnected';
  };
  bridge_filter: {
    active: boolean;
    dropped_packets: number;
    dropped_bytes: number;
  };
  capture: {
    active: boolean;
    elapsed: number;
    file_size: number;
  };
  version: {
    current: string;
    latest: string;
    branch: string;
    update_available: boolean;
  };
}

export interface AircraftProfile {
  name: string;
  tailscale_ip: string;
  ssh_password?: string;
  created: string;
  last_used: string;
}

export interface AircraftProfiles {
  version: number;
  active: string;
  profiles: Record<string, AircraftProfile>;
}

export interface CommandResponse {
  success: boolean;
  command?: string;
  output?: string;
  exit_code?: number;
  duration_seconds?: number;
  error?: string;
  log_file?: string;
  needs_password?: boolean;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
  type: 'capture' | 'log';
}

export interface FileListResponse {
  files: FileInfo[];
}

export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  source: 'setup' | 'watchdog' | 'system';
  message: string;
}

// ── Binding Management Types ──────────────────────────────────────────

export interface DiscoveredPeer {
  hostname: string;
  ip: string;
  role: 'gcs' | 'aircraft' | 'unknown';
  connection_mode: 'online' | 'stale' | 'offline';
  git_version?: string;
  git_branch?: string;
  is_self: boolean;
  is_bound: boolean;
  bound_profile_id?: string;
  bound_profile_name?: string;
  wg_rx_bytes: number;
  wg_tx_bytes: number;
  wg_last_handshake: number;
}

export interface PeerDiscovery {
  self: DiscoveredPeer;
  peers: DiscoveredPeer[];
}

export interface LinkSettings {
  kcp_nodelay: number;
  kcp_interval: number;
  kcp_resend: number;
  kcp_nc: number;
  kcp_segment_mtu: number;
  kcp_sndwnd: number;
  kcp_rcvwnd: number;
  kcp_sockbuf: number;
  kcp_smuxbuf: number;
  kcp_streambuf: number;
  bridge_mtu: number;
}

export interface OutageEvent {
  type: 'loss' | 'recovery';
  start: number;
  end: number;
  duration_seconds: number;
  retrans_count: number;
  lost_count: number;
}

export interface OutageResponse {
  outages: OutageEvent[];
  summary: {
    total_outages: number;
    total_recoveries: number;
    total_outage_seconds: number;
    total_recovery_seconds: number;
    uptime_pct: number;
    total_retrans: number;
    total_lost: number;
  };
  current: {
    in_outage: boolean;
    in_recovery: boolean;
    retrans_rate: number;
  };
}

export interface KcpStats {
  timestamp: number;
  bytes_sent: number;
  bytes_received: number;
  connections: number;
  in_pkts: number;
  out_pkts: number;
  in_segs: number;
  out_segs: number;
  in_bytes: number;
  out_bytes: number;
  retrans: number;
  fast_retrans: number;
  early_retrans: number;
  lost: number;
}

export interface LinkProfile {
  upload_mbps: number;
  download_mbps: number;
  latency_budget_ms: number;
  computed?: {
    sockbuf: number;
    smuxbuf: number;
    streambuf: number;
    sndwnd: number;
    rcvwnd: number;
  };
}

export interface BindingDetail {
  profile_id: string;
  name: string;
  ip: string;
  created: string;
  last_used: string;
  status: 'connected' | 'disconnected' | 'unreachable';
  tap2tcp_streams?: number;
  tap2tcp_flows?: number;
  wg_rx_bytes?: number;
  wg_tx_bytes?: number;
}
