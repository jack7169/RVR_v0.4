// Project-specific update configuration for RVR.
// Starnav has its own version of this file.

import { listAircraft } from './api/client';
import type { AircraftProfile } from './api/types';
import type { UpdateDevice } from '@update/types';

export const updateConfig = {
  projectName: 'Robust Virtual Radio',
  projectShort: 'RVR',
  repoUrl: 'https://github.com/jack7169/RVR_v0.4',
  modalTitle: 'Update RVR',
  hasRemoteDevices: true,
};

export async function fetchUpdateDevices(): Promise<UpdateDevice[]> {
  const data = await listAircraft();
  const devices: UpdateDevice[] = [];
  for (const [id, profile] of Object.entries(data.profiles) as [string, AircraftProfile][]) {
    devices.push({ id, label: `${profile.name} (${profile.tailscale_ip})`, ip: profile.tailscale_ip });
  }
  return devices;
}
