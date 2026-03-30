# RVR v0.4 — Multi-Stream L2 Bridge

Multi-stream Layer 2 bridge for BVLOS remotely piloted aircraft over Starlink satellite networks.

## What's New in v0.4

- **l2tap proxy** replaces tinc — per-flow multi-stream tunneling eliminates head-of-line blocking (up to 128 streams)
- **Web UI with binding management** — discover VPN peers, one-click aircraft binding with real-time setup logs
- **VPN-agnostic peer discovery** — WireGuard peer enumeration + HTTP probes, works on Tailscale/Headscale/raw WG
- **Network charts** — recharts area charts with server-side 6h history, instant time window switching
- **Link tuning** — KCPtun parameter editor with Starlink Optimized preset and detailed per-field help
- **Built-in documentation** — Help tab with quick start guide, link tuning reference, troubleshooting
- **Modern UI stack** — React 19, Radix UI, Sonner toasts, lucide icons, lazy loading with code splitting

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
│     │  VPN  │               │    Starlink Link     │     │  VPN  │               │
│     │(WG)   │◄──────────────┼────────────────────►─┼─────│(WG)   │               │
│     └───────┘  WireGuard    │                      │     └───────┘               │
└─────────────────────────────┘                      └─────────────────────────────┘
```

### How It Works

1. **l2tap** reads Ethernet frames from a TAP interface bridged to br-lan
2. Each frame is classified by its src+dst MAC pair (asymmetric — each direction is a separate flow)
3. Each unique flow gets its own TCP connection to kcptun
4. **kcptun** multiplexes each TCP connection as a separate smux v2 stream over a single KCP/UDP tunnel
5. The **VPN** (Tailscale, Headscale, or raw WireGuard) provides the encrypted path over Starlink

This eliminates head-of-line blocking: a stalled video stream from one camera cannot block MAVLink telemetry or traffic from other devices.

### Key Properties

- **Per-flow ordering guaranteed**: Each direction between two devices has its own stream with TCP ordering
- **Dynamic scaling**: Streams created on demand, up to 128, with 300s idle timeout
- **Broadcast isolation**: Multicast/broadcast traffic uses a dedicated stream (stream 0)
- **Starlink-optimized**: KCP ARQ tuned for 100-500ms periodic drops (resend=4, interval=20ms)
- **VPN-agnostic**: Works on Tailscale, Headscale, or raw WireGuard — no provider-specific APIs

## Quick Start

### GCS (Ground Control Station)
```bash
curl -fsSL https://raw.githubusercontent.com/jack7169/RVR_v0.4/main/install.sh | sh -s -- --role gcs
```

### Aircraft
```bash
curl -fsSL https://raw.githubusercontent.com/jack7169/RVR_v0.4/main/install.sh | sh -s -- --role aircraft
```

### Bind Aircraft (Web UI)
1. Open `http://<gcs-ip>:8081` (web UI installed automatically)
2. Go to **Binding** tab
3. Find aircraft in **Network Discovery** (auto-discovered via WireGuard)
4. Click **Bind** → enter name → SSH password if needed → setup runs automatically
5. Real-time setup log streams in the modal

### Bind Aircraft (CLI)
```bash
l2bridge setup <aircraft_ip> <aircraft_name>
```

## Web UI

The control panel runs on port 8081 with three tabs:

### Dashboard
- Connection status with uptime timer
- GCS and Aircraft service status with lucide icons
- Network statistics with recharts area charts (15s / 1m / 5m / 15m / 1h / 6h)
- Server-side stats history (6h rolling buffer, available immediately on page load)
- Bridge controls (start/stop/restart) with icon buttons
- Packet capture with duration control
- Live log viewer with level filters, search, fullscreen expand, copy
- File manager with relative timestamps and download/delete

### Binding
- **Network Discovery** — auto-discovers VPN peers via WireGuard + HTTP probes
- **Bound Aircraft** — manage profiles with activate/connect/remove
- **Link Settings** — KCPtun parameter editor with detailed hover help and Starlink preset
- **Add Peer** — manually enter IPs for devices not auto-discovered
- Version mismatch warnings between GCS and aircraft

### Help
- **Quick Start** — step-by-step install, bind, verify, switch aircraft
- **Link Tuning** — ARQ parameters, buffering, Starlink rationale, when to adjust
- **Troubleshooting** — bridge not forwarding, streams stuck, SSH errors, latency issues

## Tech Stack

### Frontend
React 19, Vite 8, Tailwind CSS 4, TypeScript 5.9, recharts, @tanstack/react-query, @radix-ui (dialog/tabs/tooltip), sonner, lucide-react, date-fns, react-hook-form + zod

### Backend
POSIX sh CGI scripts on uhttpd (OpenWrt), l2tap C proxy (epoll, static musl binary)

### CI
GitHub Actions: Node 22 for web UI build, aarch64-linux-gnu-gcc for l2tap cross-compile

## Requirements

- OpenWrt 23.05+ on aarch64 (tested: GL.iNet GL-BE3600, GL-A1300)
- WireGuard-based VPN (Tailscale, Headscale, or raw WireGuard)
- Starlink or other WAN connectivity

## Project Structure

```
RVR_v0.4/
├── l2tap/                  # C proxy source (epoll, 128 max streams)
│   ├── include/l2tap.h     # Constants, structs, prototypes
│   ├── src/                # main, tap, frame, flow, stream, loop, log
│   └── Makefile            # Host + aarch64 cross-compile
├── l2bridge                # Main CLI script (~1900 lines, POSIX sh)
├── install.sh              # Bootstrap installer for OpenWrt
├── www-next/               # React UI source (built by CI)
│   └── src/
│       ├── components/     # Dashboard, BindingManager, NetworkStats, LogViewer, HelpPage
│       ├── api/            # TypeScript API client + types
│       ├── hooks/          # useStatus (React Query), useNetHistory, useLogStream
│       └── lib/            # utils, zod schemas
├── www/                    # Built UI + CGI backend (deployed to device)
│   ├── cgi-bin/            # status.cgi, api.cgi, logs.cgi, discovery.cgi
│   └── assets/             # Code-split JS/CSS chunks (committed by CI)
├── packages/               # Offline .ipk bundle + l2tap binary
└── .github/workflows/      # CI: build-l2tap.yml, build-ui.yml
```

## CI / Build

| Workflow | Trigger | Output |
|----------|---------|--------|
| **Build Web UI** | Push to `www-next/**` | Code-split chunks to `www/assets/` |
| **Build l2tap** | Push to `l2tap/**` | `packages/common/l2tap-aarch64` |

### Local Development
```bash
cd www-next && npm ci && npm run dev   # UI dev server (proxies CGI to router)
cd l2tap && make                        # Host build (testing)
cd l2tap && make cross                  # aarch64 cross-compile
```

## License

Proprietary — Kuruka
