import type {
  StatusResponse, AircraftProfiles, CommandResponse,
  FileListResponse, PeerDiscovery, LinkSettings,
} from './types';

const API_BASE = '/cgi-bin';

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/status.cgi`);
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return res.json();
}

async function postApi(body: Record<string, unknown>): Promise<CommandResponse> {
  const res = await fetch(`${API_BASE}/api.cgi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API call failed: ${res.status}`);
  return res.json();
}

export async function executeCommand(
  action: string,
  aircraftIp?: string,
  aircraftName?: string,
): Promise<CommandResponse> {
  return postApi({ action, aircraft_ip: aircraftIp, aircraft_name: aircraftName });
}

export async function listAircraft(): Promise<AircraftProfiles> {
  const res = await fetch(`${API_BASE}/api.cgi?action=list_aircraft`);
  if (!res.ok) throw new Error(`List aircraft failed: ${res.status}`);
  return res.json();
}

export async function addAircraft(
  id: string, name: string, ip: string, password?: string,
): Promise<CommandResponse> {
  return postApi({ action: 'add_aircraft', id, name, tailscale_ip: ip, ssh_password: password || '' });
}

export async function updateAircraft(
  id: string, name?: string, ip?: string, password?: string,
): Promise<CommandResponse> {
  return postApi({ action: 'update_aircraft', id, name, tailscale_ip: ip, ssh_password: password });
}

export async function deleteAircraft(id: string): Promise<CommandResponse> {
  return postApi({ action: 'delete_aircraft', id });
}

export async function setActiveAircraft(id: string): Promise<CommandResponse> {
  return postApi({ action: 'set_active', id });
}

// ── Binding Management ────────────────────────────────────────────────

export async function discoverPeers(): Promise<PeerDiscovery> {
  const res = await fetch(`${API_BASE}/api.cgi?action=discover_peers`);
  if (!res.ok) throw new Error(`Discover peers failed: ${res.status}`);
  return res.json();
}

export async function bindAircraft(
  ip: string, name: string, password: string,
): Promise<CommandResponse> {
  return postApi({ action: 'bind_aircraft', tailscale_ip: ip, name, ssh_password: password });
}

export async function unbindAircraft(id: string): Promise<CommandResponse> {
  return postApi({ action: 'unbind_aircraft', id });
}

export async function connectAircraft(id: string): Promise<CommandResponse> {
  return postApi({ action: 'connect_aircraft', id });
}

export async function addPeerIp(ip: string): Promise<CommandResponse> {
  return postApi({ action: 'add_peer', ip });
}

export async function removePeerIp(ip: string): Promise<CommandResponse> {
  return postApi({ action: 'remove_peer', ip });
}

export async function getLinkSettings(): Promise<LinkSettings> {
  const res = await fetch(`${API_BASE}/api.cgi?action=get_link_settings`);
  if (!res.ok) throw new Error(`Get link settings failed: ${res.status}`);
  return res.json();
}

export async function updateLinkSettings(
  settings: Partial<LinkSettings>,
  restart = false,
): Promise<CommandResponse> {
  return postApi({ action: 'update_link_settings', settings, restart });
}

export async function fetchLinkProfile(): Promise<import('./types').LinkProfile> {
  const res = await fetch(`${API_BASE}/api.cgi?action=get_link_profile`);
  if (!res.ok) throw new Error(`Link profile fetch failed: ${res.status}`);
  return res.json();
}

export async function updateLinkProfile(
  upload_mbps: number, download_mbps: number, latency_budget_ms: number,
): Promise<CommandResponse> {
  return postApi({ action: 'update_link_profile', upload_mbps: String(upload_mbps), download_mbps: String(download_mbps), latency_budget_ms: String(latency_budget_ms) });
}

export async function fetchOutages(): Promise<import('./types').OutageResponse> {
  const res = await fetch(`${API_BASE}/api.cgi?action=outages`);
  if (!res.ok) throw new Error(`Outages fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchStarlinkOutages(windowSeconds = 3600): Promise<import('./types').StarlinkOutageResponse> {
  const res = await fetch(`${API_BASE}/api.cgi?action=starlink_outages&window=${windowSeconds}`);
  if (!res.ok) throw new Error(`Starlink outages fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchKcpStats(): Promise<import('./types').KcpStats> {
  const res = await fetch(`${API_BASE}/api.cgi?action=kcp_stats`);
  if (!res.ok) throw new Error(`KCP stats fetch failed: ${res.status}`);
  return res.json();
}

export interface StatsHistoryResponse {
  points: Array<{ t: number; rx: number; tx: number; pkts: number; wan_rx: number; wan_tx: number }>;
}

export async function fetchStatsHistory(windowSeconds = 900): Promise<StatsHistoryResponse> {
  const res = await fetch(`${API_BASE}/api.cgi?action=stats_history&window=${windowSeconds}`);
  if (!res.ok) throw new Error(`Stats history failed: ${res.status}`);
  return res.json();
}

// ── Update Management ────────────────────────────────────────────────

export async function updateLocal(branch?: string): Promise<CommandResponse> {
  const body: Record<string, unknown> = { action: 'update_local' };
  if (branch) body.branch = branch;
  return postApi(body);
}

export async function updateRemote(aircraftIp: string, branch?: string): Promise<CommandResponse> {
  const body: Record<string, unknown> = { action: 'update_remote', aircraft_ip: aircraftIp };
  if (branch) body.branch = branch;
  return postApi(body);
}

export async function updateBoth(aircraftIp: string, branch?: string): Promise<CommandResponse> {
  const body: Record<string, unknown> = { action: 'update_both', aircraft_ip: aircraftIp };
  if (branch) body.branch = branch;
  return postApi(body);
}

export interface CheckUpdateResponse {
  current: string;
  latest: string;
  branch: string;
  update_available: boolean;
}

export async function checkUpdate(): Promise<CheckUpdateResponse> {
  const res = await fetch(`${API_BASE}/api.cgi?action=check_update`);
  if (!res.ok) throw new Error(`Check update failed: ${res.status}`);
  return res.json();
}

export interface BranchList {
  current: string;
  branches: string[];
}

export async function listBranches(): Promise<BranchList> {
  const res = await fetch(`${API_BASE}/api.cgi?action=list_branches`);
  if (!res.ok) throw new Error(`List branches failed: ${res.status}`);
  return res.json();
}

// ── Capture & Files ───────────────────────────────────────────────────

export async function startCapture(duration = 60): Promise<CommandResponse> {
  return postApi({ action: 'capture_start', duration: String(duration) });
}

export async function stopCapture(): Promise<CommandResponse> {
  return postApi({ action: 'capture_stop' });
}

export async function listFiles(): Promise<FileListResponse> {
  const res = await fetch(`${API_BASE}/api.cgi?action=list_files`);
  if (!res.ok) throw new Error(`List files failed: ${res.status}`);
  return res.json();
}

export async function deleteFile(filename: string): Promise<CommandResponse> {
  return postApi({ action: 'delete_file', file: filename });
}

export function getDownloadUrl(filename: string): string {
  return `${API_BASE}/api.cgi?action=download&file=${encodeURIComponent(filename)}`;
}
