# RVR v0.4 — Multi-Stream L2 Bridge

Multi-stream Layer 2 bridge for BVLOS remotely piloted aircraft over Starlink satellite networks.

## Architecture

```
Ground Control Station (GCS)                          Aircraft
┌─────────────────────────────┐                      ┌─────────────────────────────┐
│  br-lan                     │                      │  br-lan                     │
│    │                        │                      │    │                        │
│    ├── eth0 (cameras, etc.) │                      │    ├── eth0 (cameras, etc.) │
│    │                        │                      │    │                        │
│    └── TAP (l2bridge)       │                      │    └── TAP (l2bridge)       │
│         │                   │                      │         │                   │
│     ┌───┴───┐               │                      │     ┌───┴───┐               │
│     │ l2tap │ (server)      │                      │     │ l2tap │ (client)      │
│     └─┬─┬─┬─┘              │                      │     └─┬─┬─┬─┘              │
│       │ │ │  N TCP conns    │                      │       │ │ │  N TCP conns    │
│     ┌─┴─┴─┴─┐              │                      │     ┌─┴─┴─┴─┐              │
│     │kcptun │ (server)      │                      │     │kcptun │ (client)      │
│     │smux v2│               │                      │     │smux v2│               │
│     └───┬───┘               │                      │     └───┬───┘               │
│         │ KCP/UDP           │                      │         │ KCP/UDP           │
│     ┌───┴───┐               │                      │     ┌───┴───┐               │
│     │  Tail │               │    Starlink Link     │     │  Tail │               │
│     │ scale │◄──────────────┼────────────────────►─┼─────│ scale │               │
│     └───────┘  WireGuard    │                      │     └───────┘               │
└─────────────────────────────┘                      └─────────────────────────────┘
```

### How It Works

1. **l2tap** reads Ethernet frames from a TAP interface bridged to br-lan
2. Each frame is classified by its src+dst MAC pair (asymmetric — each direction is a separate flow)
3. Each unique flow gets its own TCP connection to kcptun
4. **kcptun** multiplexes each TCP connection as a separate smux v2 stream over a single KCP/UDP tunnel
5. **Tailscale** provides the WireGuard-encrypted path between GCS and Aircraft over Starlink

This eliminates head-of-line blocking: a stalled video stream from one camera cannot block MAVLink telemetry or traffic from other devices.

### Key Properties

- **Per-flow ordering guaranteed**: Each direction between two devices has its own stream with TCP ordering
- **Dynamic scaling**: Streams created on demand, up to 32, with 300s idle timeout
- **Broadcast isolation**: Multicast/broadcast traffic uses a dedicated stream (stream 0)
- **Starlink-optimized**: KCP ARQ tuned for 100-500ms periodic drops (resend=4, interval=20ms)

## Quick Start

### GCS (Ground Control Station)
```bash
curl -fsSL https://raw.githubusercontent.com/jack7169/RVR_v0.4/main/install.sh | sh -s -- --role gcs
```

### Aircraft
```bash
curl -fsSL https://raw.githubusercontent.com/jack7169/RVR_v0.4/main/install.sh | sh -s -- --role aircraft
```

### Setup Bridge
```bash
l2bridge setup <aircraft_tailscale_ip>
```

## Requirements

- OpenWrt 23.05+ on aarch64 (tested: GL.iNet GL-BE3600, GL-A1300)
- Tailscale installed and authenticated on both routers
- Starlink or other WAN connectivity

## Components

| Component | Purpose |
|-----------|---------|
| `l2tap` | Custom C proxy — TAP to multi-stream TCP fan-out (~50KB static binary) |
| `kcptun` | KCP/UDP reliable transport with smux v2 multiplexing |
| `l2bridge` | CLI tool for setup, management, and monitoring |
| `www/` | Web UI for status monitoring and control (React + Tailwind) |

## License

Proprietary — Kuruka
