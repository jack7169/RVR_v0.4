// shared/update/frontend/api.ts
// Update API functions shared between RVR and Starnav.

import type { CommandResponse, CheckUpdateResponse, BranchList } from './types';

const API_BASE = '/cgi-bin';

export async function updateDevices(
  remoteIps: string[],
  includeLocal: boolean,
  branch?: string,
): Promise<CommandResponse> {
  const body: Record<string, unknown> = {
    action: 'update_devices',
    remote_ips: remoteIps.join(','),
    include_local: includeLocal ? 'true' : 'false',
  };
  if (branch) body.branch = branch;
  const res = await fetch(`${API_BASE}/api.cgi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status}`);
  return res.json();
}

export async function checkUpdate(): Promise<CheckUpdateResponse> {
  const res = await fetch(`${API_BASE}/api.cgi?action=check_update`);
  if (!res.ok) throw new Error(`Check update failed: ${res.status}`);
  return res.json();
}

export async function listBranches(): Promise<BranchList> {
  const res = await fetch(`${API_BASE}/api.cgi?action=list_branches`);
  if (!res.ok) throw new Error(`List branches failed: ${res.status}`);
  return res.json();
}
