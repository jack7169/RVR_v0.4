# RVR v0.4 — Multi-Stream RVR

## What This Is
Kuruka RVR v0.4 is an L2 bridge for BVLOS remotely piloted aircraft over Starlink satellite links. It replaces RVR v0.3's tinc VPN with a custom C proxy (`tap2tcp`) that provides per-flow multi-stream tunneling through kcptun's smux v2.

## Architecture
```
br-lan -> TAP (rvr_bridge) -> tap2tcp -> N TCP connections -> kcptun (smux v2) -> KCP/UDP -> Tailscale -> Starlink
```

tap2tcp classifies Ethernet frames by asymmetric src+dst MAC pair. Each direction between two devices gets its own TCP connection -> smux stream, guaranteeing per-direction ordering without cross-device head-of-line blocking. Broadcast/multicast always uses stream 0.

## Target Platform
- OpenWrt 23.05-SNAPSHOT on GL.iNet routers (GL-BE3600, GL-A1300)
- aarch64_cortex-a53, 512MB flash, 1GB RAM
- BusyBox ash shell — ALL scripts must be POSIX sh (no bash arrays, no `[[`, no process substitution)

## Directory Layout
```
tap2tcp/                C proxy source (single-threaded epoll, static musl binary)
robust_virtual_radio    Main CLI script (POSIX sh, ~2300 lines)
install.sh              Bootstrap installer for OpenWrt devices
www/                    Built web UI (committed by CI, served by uhttpd :8081)
www/cgi-bin/            CGI backend (status.cgi, api.cgi, logs.cgi, starlink_outages.py)
www-next/               React 19 + Vite + Tailwind source for web UI
packages/               Bundled .ipk files + tap2tcp binary for offline install
starlink-grpc-tools/    Bundled starlink_grpc.py for Starlink dish API
docs/                   Bridge firewall rules, known issues
.github/workflows/      CI: cross-compile tap2tcp, build web UI
```

## Building tap2tcp
```bash
# Host build (for testing)
cd tap2tcp && make

# Cross-compile for OpenWrt aarch64
cd tap2tcp && make cross    # requires aarch64-linux-musl-gcc
```

## Key Constraints
- tap2tcp must be a static binary (~50KB) with zero runtime deps
- TAP interface name is `rvr_bridge` (must match -t flag in init scripts AND up/down scripts)
- kcptun local ports are TCP-only; each TCP connection = one smux stream
- Bundle .ipk packages in repo — avoid `opkg update` on routers
- /tmp is tmpfs (RAM) — cap all logs, never write unbounded data there
- Use `dbclient` not `ssh`, dropbear `scp` has no `-O` flag
- procd init scripts with respawn 3600 5 5 (prevents bootloop)
- Scripts use `logger -t rvr` for syslog, tee to /tmp for setup logs
- All git operations MUST use `--depth=1` — full history wastes flash storage
- NEVER use `uci commit network` — triggers netifd to tear down br-lan, bricks the router
- NEVER use `/etc/init.d/firewall reload` during uninstall — kernel panic in QCA PPE/tun driver
- NEVER use `--force-depends` with opkg remove — breaks shared GL.iNet system libraries
- NEVER remove kmod-tun, libopenssl3, libcurl4, zlib, ca-bundle, liblzo2 via opkg
- `ssh_aircraft` wrapper uses `timeout 120` — remote commands must not hang indefinitely
- Uninstall must remove uhttpd config + restart + kill orphaned CGI processes BEFORE removing any packages (Python segfault from grpcio removal crashes GL-BE3600)
- Install footprint is ~85MB on /overlay (repo + packages + Python + pip packages)
- STP is runtime-only (`ip link set stp_state 1`) — never persisted via UCI
- BusyBox `tr` does NOT support POSIX character classes — use `tr 'A-Z' 'a-z'` not `tr '[:upper:]' '[:lower:]'`
- CLI script runs on BOTH GCS and aircraft — use `get_local_role()` for role detection, never hardcode kcptun-server
- Role detection: `[ -f /etc/init.d/kcptun-server ]` = GCS, `[ -f /etc/init.d/kcptun-client ]` = aircraft
- After `rvr update`, the running shell process has OLD code — restart must invoke `/usr/bin/rvr restart` (new binary on disk)
- Discovery cache (`/tmp/rvr-discovery-cache.json`) must be invalidated after bind, unbind, and update operations
- Starlink dish has 900s ring buffer + structured `history.outages` array (GPS timestamps, cause enums)

## Conventions
- `rvr` is the single CLI entry point with subcommands (setup, start, stop, status, profile, unbind, etc.)
- CLI is the single source of truth — api.cgi delegates to CLI via `run_rvr_command()`
- Profile management: `rvr profile list|add|update|delete|set-active` (api.cgi delegates here)
- Aircraft profiles stored in /etc/rvr/aircraft.json
- Health status at /tmp/rvr.health, tap2tcp stats at /tmp/tap2tcp.stats
- Watchdog runs via cron every minute, logs resource snapshots (procs, FDs, RAM, /tmp, /overlay)
- Boot recovery via rc.local
- No authentication in tap2tcp — Tailscale provides WireGuard encryption
- Bridge firewall: 3 layers of loop prevention (see docs/bridge-firewall-rules.md)
- Starlink outage data read from dish `history.outages` array (GPS epoch timestamps, cause enums), cached 30s
- Web UI dashboard order: Bridge Traffic → KCPtun Link Quality → WAN Traffic → Starlink Link Quality
- Version mismatch banner (GCS ≠ Aircraft) shown globally when connected
- Link profile auto-selects preset based on measured VPN mode (direct/relay)
- Summary stats computed client-side for instant window switching (Starlink + KCPtun panels)
- Uninstall order: deregister uhttpd → stop services → remove watchdog → remove config → remove packages → remove files
