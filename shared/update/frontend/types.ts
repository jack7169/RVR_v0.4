// shared/update/frontend/types.ts
// Unified update types shared between RVR and Starnav.

export interface VersionInfo {
  current: string;
  latest: string;
  branch: string;
  update_available: boolean;
}

export interface CheckUpdateResponse {
  current: string;
  latest: string;
  branch: string;
  update_available: boolean;
}

export interface BranchList {
  current: string;
  branches: string[];
}

export interface UpdateDevice {
  id: string;
  label: string;
  ip?: string;
}

export interface CommandResponse {
  success: boolean;
  command?: string;
  output?: string;
  exit_code?: number;
  duration_seconds?: number;
  error?: string;
  log_file?: string;
}
