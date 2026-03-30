# RVR v0.4 — Multi-Stream L2 Bridge

Multi-stream Layer 2 bridge for BVLOS remotely piloted aircraft over Starlink satellite networks.

## What's New in v0.4

- **l2tap proxy** replaces tinc — per-flow multi-stream tunneling eliminates head-of-line blocking
- **Binding Management UI** — discover Tailscale peers, one-click aircraft binding, link settings editor
- **No more CLI-only aircraft management** — add/swap/remove aircraft from the web UI
- **KCPtun link tuning** — presets (Starlink Optimized, Low Latency, High Throughput) configurable from UI

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

### Setup Bridge (CLI)
```bash
l2bridge setup <aircraft_tailscale_ip> <aircraft_name>
```

### Setup Bridge (Web UI)
1. Install web UI: `l2bridge webui-install`
2. Open `http://<router-ip>:8081`
3. Go to **Binding** tab
4. Find aircraft in **Network Discovery**, click **Bind**
5. Enter name and SSH password — setup runs automatically

## Web UI

The control panel runs on port 8081 and has two tabs:

### Dashboard
- GCS and Aircraft service status
- L2TAP stream/flow counts
- Network statistics with live rates
- Bridge controls (start/stop/restart)
- Packet capture and log viewer

### Binding
- **Network Discovery** — auto-discovers all Tailscale peers, shows hostname, IP, online status, connection mode (direct/relay)
- **Bound Aircraft** — manage profiles, activate, connect, remove
- **Link Settings** — edit KCPtun parameters with presets, push to both sides, restart

## Requirements

- OpenWrt 23.05+ on aarch64 (tested: GL.iNet GL-BE3600, GL-A1300)
- Tailscale installed and authenticated on both routers
- Starlink or other WAN connectivity

## Components

| Component | Description |
|-----------|-------------|
| `l2tap` | C proxy — TAP to multi-stream TCP fan-out (~50KB static musl binary) |
| `kcptun` | KCP/UDP reliable transport with smux v2 multiplexing |
| `l2bridge` | POSIX sh CLI for setup, management, and monitoring |
| `www-next/` | React 19 + Vite + Tailwind web UI source |
| `www/` | Built web UI (committed by CI, served via uhttpd) |
| `www/cgi-bin/` | Shell CGI backend (status, API, log streaming) |
| `packages/` | Bundled .ipk files + l2tap binary for offline install |

## Project Structure

```
RVR_v0.4/
├── l2tap/                  # C proxy source
│   ├── include/l2tap.h     # Constants, structs, prototypes
│   ├── src/                # main, tap, frame, flow, stream, loop, log
│   └── Makefile            # Host + aarch64 cross-compile
├── l2bridge                # Main CLI script (~1900 lines, POSIX sh)
├── install.sh              # Bootstrap installer for OpenWrt
├── www-next/               # React UI source (built by CI)
│   └── src/
│       ├── components/     # Dashboard, BindingManager, status cards, controls
│       ├── api/            # TypeScript API client + types
│       └── hooks/          # useStatus, useRates, useLogStream
├── www/                    # Built UI + CGI backend (deployed to device)
│   ├── cgi-bin/            # status.cgi, api.cgi, logs.cgi
│   └── assets/             # Built JS/CSS (committed by CI)
├── packages/               # Offline .ipk bundle + l2tap binary
│   ├── common/             # Shared deps + l2tap-aarch64
│   ├── gcs/                # kcptun-server, sshpass
│   └── aircraft/           # kcptun-client
└── .github/workflows/      # CI: build-l2tap.yml, build-ui.yml
```

## CI / Build

The web UI and l2tap binary are built by GitHub Actions — not on the device.

| Workflow | Trigger | Output |
|----------|---------|--------|
| **Build Web UI** | Push to `www-next/**` | Commits built assets to `www/` |
| **Build l2tap** | Push to `l2tap/**` | Commits `packages/common/l2tap-aarch64` |

Both workflows support `workflow_dispatch` for manual triggering.

### Local Development
```bash
# Web UI dev server (proxies CGI to router)
cd www-next && npm ci && npm run dev

# Build l2tap for host (testing)
cd l2tap && make

# Cross-compile l2tap for aarch64
cd l2tap && make cross  # requires aarch64-linux-musl-gcc
```

## CLI Reference

```
l2bridge <command> [options]

Setup & Connection:
  setup <ip> <name>         Full setup of GCS + Aircraft
  add <ip|name> [name]      Connect to already-setup aircraft
  start/stop/restart        Service management
  status                    Local bridge status
  remote <ip|name>          Aircraft status via SSH

Monitoring:
  logs [lines]              Recent logs (default: 20)
  debug <ip|name>           Full diagnostics
  capture [duration]        Packet capture (default: 60s)
  monitor [--daemon]        Health check and auto-repair

Management:
  webui-install/remove      Web UI on port 8081
  watchdog-install/remove   Cron-based auto-recovery
  remove-aircraft <name>    Uninstall from aircraft
  uninstall [ip]            Remove everything
  update                    Pull latest from GitHub
```

## License

Proprietary — Kuruka
