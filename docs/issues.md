# Known Issues

## GL-BE3600: Uncommanded reboot during uninstall

**Status:** Investigating  
**Severity:** High  
**Affected hardware:** GL.iNet GL-BE3600 (OpenWrt 23.05-SNAPSHOT, QCA IPQ53xx)

### Symptoms
- Running `rvr uninstall` causes the router to reboot ~30-60 seconds into the process
- The reboot is clean (no kernel panic in mtdoops, reset_reason shows "System reset or reboot [0x10]")
- Occurs consistently during the opkg package removal phase
- The partial uninstall leaves the system in a mixed state

### What we know
- Not a kernel panic — mtdoops is empty after the crash
- Not the GL.iNet modem recovery script (no modem present, no cron job)
- The reboot happens during or shortly after `opkg remove` of Python/kcptun packages
- The web UI was polling status.cgi every 3 seconds during the uninstall
- The Starlink panel showed "query failed" (grpcio was removed by pip before opkg started)

### Suspected causes
1. `opkg remove` triggers `default_prerm` which calls init script `stop` — could interact with procd in unexpected ways
2. GL.iNet firmware may have a watchdog or health monitor that triggers reboot when services are removed
3. Heavy I/O from simultaneous pip uninstall + opkg remove + status.cgi polling could trigger procd's hardware watchdog

### Workaround
Run uninstall without the web UI open (close browser tab first).

---

## GL-BE3600: Kernel panic from firewall reload with kmod-tun

**Status:** Fixed (commit 9fa8e8e)  
**Severity:** Critical  
**Affected hardware:** GL.iNet GL-BE3600

### Root cause
`/etc/init.d/firewall reload` while `kmod-tun` is loaded triggers a null pointer dereference in the QCA PPE driver's TUN offload registration callback.

### Stack trace
```
register_netdevice+0x2f8/0x460
tun_register_offload_stats_callback+0x4dec/0x6a50 [tun]
vfs_ioctl+0x24/0x48
ksys_ioctl+0x48/0x78
Kernel panic - not syncing: Fatal exception
```

### Fix
Removed `/etc/init.d/firewall reload` from uninstall and webui-remove paths. Firewall rules are removed surgically via `nft delete rule` by handle instead of a full reload. The `cmd_webui_install` firewall reload during fresh install is safe because kmod-tun isn't loaded yet at that point.

---

## GL-BE3600: `uci commit network` bricks router

**Status:** Fixed (commit 51d3ce9)  
**Severity:** Critical  
**Affected hardware:** GL.iNet GL-BE3600

### Root cause
`uci commit network` signals netifd to reconcile running state with config. On GL-BE3600, this can tear down and rebuild br-lan, killing WiFi, DHCP, and all LAN connectivity. The router becomes unresponsive and requires reflashing via debug interface.

### Fix
All `uci commit network` and `uci set network` calls removed from the codebase. STP is managed runtime-only via `ip link set br-lan type bridge stp_state 1/0`.

---

## Python packages not fully bundled for offline install

**Status:** Open  
**Severity:** Medium

### Symptoms
Fresh install downloads Python packages from opkg feeds and pip from PyPI. Several python3 subpackages (python3-asyncio, python3-cgitb, python3-codecs, python3) and all pip packages (grpcio, protobuf, yagrc, typing-extensions) require network access.

### Root cause
The bundled .ipk files in `packages/common/` are missing some python3 subpackages that were installed as dependencies rather than being explicitly bundled. The pip packages (grpcio wheel, protobuf, etc.) are not bundled at all — they're downloaded from PyPI every install.

### Impact
- Offline/air-gapped install fails for Python dependencies
- Install takes ~5 minutes longer due to downloads
- Inconsistent package versions if PyPI packages update between installs

### Fix needed
1. Re-pull all python3 .ipk subpackages from the router after a complete install
2. Bundle pip wheels in the repo (download grpcio aarch64 musllinux wheel, protobuf, yagrc, typing-extensions)
3. Have `install_python_packages` install from local wheels first: `pip install --no-index --find-links packages/pip/ grpcio protobuf yagrc typing-extensions`
