import { z } from 'zod';

export const linkSettingsSchema = z.object({
  kcp_nodelay: z.number().int().min(0).max(1),
  kcp_interval: z.number().int().min(1).max(1000),
  kcp_resend: z.number().int().min(0).max(32),
  kcp_nc: z.number().int().min(0).max(1),
  kcp_segment_mtu: z.number().int().min(100).max(1400),
  kcp_sndwnd: z.number().int().min(32).max(8192),
  kcp_rcvwnd: z.number().int().min(32).max(8192),
  kcp_sockbuf: z.number().int().min(65536).max(67108864),
  kcp_smuxbuf: z.number().int().min(65536).max(67108864),
  kcp_streambuf: z.number().int().min(65536).max(67108864),
  bridge_mtu: z.number().int().min(576).max(9000),
});

export const aircraftNameSchema = z.string().min(2, 'Name must be at least 2 characters').max(64);

export const vpnIpSchema = z.string().regex(/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Must be a VPN IP (100.x.x.x)');
