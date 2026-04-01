# RVR v0.4 — Multi-Stream RVR

## What This Is
Kuruka RVR v0.4 is an L2 bridge for BVLOS remotely piloted aircraft over Starlink satellite links. It replaces RVR v0.3's tinc VPN with a custom C proxy (`tap2tcp`) that provides per-flow multi-stream tunneling through kcptun's smux v2.

## Architecture
```
br-lan -> TAP (rvr) -> tap2tcp -> N TCP connections -> kcptun (smux v2) -> KCP/UDP -> Tailscale -> Starlink
```

tap2tcp classifies Ethernet frames by asymmetric src+dst MAC pair. Each direction between two devices gets its own TCP connection -> smux stream, guaranteeing per-direction ordering without cross-device head-of-line blocking. Broadcast/multicast always uses stream 0.

## Target Platform
- OpenWrt 23.05-SNAPSHOT on GL.iNet routers (GL-BE3600, GL-A1300)
- aarch64_cortex-a53, 512MB flash, 1GB RAM
- BusyBox ash shell — ALL scripts must be POSIX sh (no bash arrays, no `[[`, no process substitution)

## Directory Layout
```
tap2tcp/              C proxy source (single-threaded epoll, static musl binary)
rvr            Main CLI script (POSIX sh, ~2000 lines)
install.sh          Bootstrap installer for OpenWrt devices
www/                Built web UI (committed by CI, served by lighttpd :8081)
www/cgi-bin/        CGI backend (status.cgi, api.cgi, logs.cgi)
www-next/           React 19 + Vite + Tailwind source for web UI
packages/           Bundled .ipk files + tap2tcp binary for offline install
.github/workflows/  CI: cross-compile tap2tcp, build web UI
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
- kcptun local ports are TCP-only; each TCP connection = one smux stream
- Bundle .ipk packages in repo — avoid `opkg update` on routers
- /tmp is tmpfs (RAM) — cap all logs, never write unbounded data there
- Use `dbclient` not `ssh`, dropbear `scp` has no `-O` flag
- procd init scripts with respawn 3600 5 5 (prevents bootloop)
- Scripts use `logger -t rvr` for syslog, tee to /tmp for setup logs

## Conventions
- `rvr` is the single CLI entry point with subcommands (setup, start, stop, status, etc.)
- Aircraft profiles stored in /etc/rvr/aircraft.json
- Health status at /tmp/rvr.health, tap2tcp stats at /tmp/tap2tcp.stats
- Watchdog runs via cron every minute, boot recovery via rc.local
- No authentication in tap2tcp — Tailscale provides WireGuard encryption
- nftables bridge filter allows only RFC1918/link-local/multicast through bridge
