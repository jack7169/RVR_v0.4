# Update System & Logging Safeguards — Technical Reference

Reference document for porting the RVR v0.4 update management and storage safety systems to Starnav.

## 1. Storage-Safe Update Logic

### Problem
On embedded devices with limited flash (300MB user space), repeated `git fetch` + `git reset` operations cause:
- `.git/objects/` grows unbounded (no prune, no gc)
- Stale web UI assets (JS/CSS chunks) accumulate on each build (~200KB/update)
- No pre-flight space check means a half-complete update can fill flash and brick the device

### Solution (rvr `cmd_update`)

**File:** `rvr` — `cmd_update()` function

**Key changes:**

```sh
# 1. Pre-flight space check — abort if < 30MB free
free_kb=$(df /overlay 2>/dev/null | tail -1 | awk '{print $4}')
if [ "${free_kb:-999999}" -lt 30720 ]; then
    log_error "Not enough space for update"
    exit 1
fi

# 2. Shallow fetch — only latest commit (~90% smaller than full history)
git fetch --depth=1 origin "$branch"

# 3. Reset to target
git reset --hard "origin/$branch"

# 4. Clean stale git objects immediately
git reflog expire --expire=now --all 2>/dev/null
git gc --prune=all -q 2>/dev/null

# 5. Clean old web assets BEFORE copying new (prevents accumulation)
rm -rf "$WEBUI_ROOT/assets"
mkdir -p "$WEBUI_ROOT/assets"
cp -r "$src_www/assets/"* "$WEBUI_ROOT/assets/"
```

**Critical bug fixed:** Previous code did `cp -r assets/*` without removing old files. Compare with `cmd_webui_install()` which correctly does `rm -rf assets && mkdir` first.

### Install Script Changes

**File:** `install.sh` — `download_repo()` and `setup_git_repo()`

```sh
# Shallow fetch on install too
git fetch --depth=1 origin "$REPO_BRANCH"
git reset --hard "origin/$REPO_BRANCH"
git reflog expire --expire=now --all 2>/dev/null
git gc --prune=all -q 2>/dev/null

# Save branch for update tracking
echo "$REPO_BRANCH" > /etc/rvr/branch
```

### Storage Impact

| Metric | Before | After |
|--------|--------|-------|
| `.git/` size (110 commits) | ~8.5MB | ~1MB (depth=1) |
| Stale JS assets per update | +200KB cumulative | 0 (rm -rf before copy) |
| Git objects after 50 updates | ~12MB | ~1MB (gc after each) |
| Failed update recovery | Device bricked | Aborts if < 30MB free |

---

## 2. Branch-Aware Updates

### Config Files

| File | Content | Example |
|------|---------|---------|
| `/etc/rvr/version` | Short commit hash | `abc1234` |
| `/etc/rvr/branch` | Current branch name | `main` |
| `/etc/rvr/repo` | GitHub owner/repo | `jack7169/RVR_v0.4` |

### CLI

```sh
rvr update                    # Update current branch
rvr update --branch dev       # Switch to dev branch
rvr branches                  # List available remote branches
```

### CGI API Endpoints

| Endpoint | Method | Params | Returns |
|----------|--------|--------|---------|
| `api.cgi?action=update_local` | POST | `{branch?: string}` | `{success, message, log_file}` |
| `api.cgi?action=update_remote` | POST | `{aircraft_ip, branch?: string}` | `{success, message, log_file}` |
| `api.cgi?action=check_update` | GET | — | `{current, latest, branch, update_available}` |
| `api.cgi?action=list_branches` | GET | — | `{current, branches: string[]}` |

### Status API Changes

**File:** `status.cgi`

```json
"version": {
  "current": "abc1234",
  "latest": "def5678",
  "branch": "main",
  "update_available": true
}
```

GitHub API call uses stored branch: `commits/$VERSION_BRANCH` instead of hardcoded `commits/main`.

### Discovery API Changes

**File:** `discovery.cgi`

Added `"git_branch": "main"` to JSON response. Consumed by `api.cgi` discovery pipeline and passed through to UI as `git_branch` field on each peer.

---

## 3. Boot Loop Prevention (Logging Safeguards)

### Root Cause
12+ hours of uptime exhausted RAM/flash from:
1. Stats CSV written every 1s poll (86K lines/day)
2. Orphaned `tail`/`logread`/`grep` from SSE log viewer
3. Discovery scans spawning unbounded background processes
4. SSH (`dbclient`) spawned on every status poll
5. Poll interval 1s was too aggressive

### Fixes

#### Dynamic Log Rotation (Watchdog)

**File:** `rvr` — watchdog cron script (runs every minute)

```sh
FLASH_FREE_KB=$(df /overlay 2>/dev/null | tail -1 | awk '{print $4}')

LOG_CAP=2097152    # 2MB default
SNMP_CAP=2097152

# Low space: aggressive rotation
if [ "${FLASH_FREE_KB:-999999}" -lt 20480 ]; then
    LOG_CAP=262144; SNMP_CAP=262144  # 256KB
    logger -t rvr -p daemon.warn "Low flash: ${FLASH_FREE_KB}KB free"
fi

# Critical: emergency cleanup
if [ "${FLASH_FREE_KB:-999999}" -lt 5120 ]; then
    LOG_CAP=65536; SNMP_CAP=65536    # 64KB
    rm -f /tmp/rvr-capture.pcap
    logger -t rvr -p daemon.err "CRITICAL: ${FLASH_FREE_KB}KB flash free"
fi
```

| Flash Free | Mode | Log Cap | Action |
|-----------|------|---------|--------|
| >20 MB | Normal | 2 MB/file | Full history |
| <20 MB | Low | 256 KB/file | Syslog warning |
| <5 MB | Critical | 64 KB/file | Delete captures, syslog error |

#### Throttled Polling

**File:** `status.cgi`

```sh
# Stats CSV: max 1 write per 3 seconds
STATS_FILE="/tmp/rvr-stats.csv"
if [ -f "$STATS_FILE" ]; then
    LAST_WRITE=$(date -r "$STATS_FILE" +%s 2>/dev/null || echo 0)
    NOW=$(date +%s)
    [ $((NOW - LAST_WRITE)) -lt 3 ] && SKIP_STATS=1
fi

# Remote status: cached 10 seconds (prevents SSH storms)
REMOTE_CACHE="/tmp/rvr-remote-status"
if [ -f "$REMOTE_CACHE" ]; then
    CACHE_AGE=$(( $(date +%s) - $(date -r "$REMOTE_CACHE" +%s 2>/dev/null || echo 0) ))
    [ "$CACHE_AGE" -lt 10 ] && USE_CACHED=1
fi
```

#### SSE Log Streaming Safety

**File:** `logs.cgi`

```sh
# 5-minute auto-kill timeout
( sleep 300; kill 0 ) &
TIMEOUT_PID=$!

cleanup() {
    kill "$TIMEOUT_PID" 2>/dev/null
    kill 0  # Kill entire process group
}
trap cleanup EXIT INT TERM HUP
```

#### Orphan Process Cleanup

**File:** `rvr` — watchdog

```sh
# Kill orphaned grep/tail (parent PID = 1 means orphaned)
for pid in $(pgrep -f "grep.*rvr\|tap2tcp\|kcptun" 2>/dev/null); do
    ppid=$(awk '/PPid/ {print $2}' /proc/$pid/status 2>/dev/null)
    [ "$ppid" = "1" ] && kill "$pid" 2>/dev/null
done

# Clean stale temp files (older than 1 hour)
find /tmp -name 'rvr-disc-*' -mmin +60 -delete 2>/dev/null
find /tmp -name 'rvr-logs-*.fifo' -mmin +60 -delete 2>/dev/null
```

#### Discovery Scan Timeout

**File:** `api.cgi`

```sh
# 30-second timeout with process cleanup
( sleep 30; kill 0 ) &
DISC_TIMEOUT=$!
trap "kill $DISC_TIMEOUT 2>/dev/null; rm -f $tmp_peers $tmp_results $DISCOVERY_LOCK" EXIT
```

### Frontend Poll Rate

**File:** `useStatus.ts`

```ts
// Changed from 1000ms to 3000ms
refetchInterval: 3000,
```

---

## 4. BusyBox Pitfalls (OpenWrt)

Critical issues discovered on BusyBox ash that affect both RVR and Starnav:

| Issue | Symptom | Fix |
|-------|---------|-----|
| `pgrep -x` broken | Always returns empty | Use `pgrep tap2tcp` without `-x` |
| `date +%s%3N` no milliseconds | Same as `date +%s` | `$(($(date +%s) * 1000))` |
| No `nohup` | Background from CGI fails | Plain `command &` |
| `sort -o file file` broken | Truncates file | Sort to temp, then mv |
| No bash arrays | Script fails silently | Pure POSIX sh only |
| No `[[` | Syntax error | Use `[` with proper quoting |

---

## 5. UI Components

### Update Banner (`UpdateBanner.tsx`)
- Persistent amber banner below header when `version.update_available` is true
- Shows `branch:current -> latest` with "Update Now" + dismiss + refresh buttons
- Dismiss is per-session (sessionStorage keyed by latest hash)

### Update Modal (`UpdateModal.tsx`)
- Branch selector dropdown (fetches `list_branches` on open)
- Device selection checkboxes (GCS + Aircraft)
- Warning when switching away from main
- Progress log polling (setup_log every 2s)
- Success/failure with "Reload Page" button

### Header Version (`Header.tsx`)
- Shows `branch:hash` next to title
- Green dot = up to date, amber = update available, blue = dev branch
- Refresh button triggers `check_update`

### Peer Cards (`BindingManager.tsx`)
- Every peer shows `branch:hash` with color coding
- Branch mismatch = red border (more severe than version mismatch)
- Version mismatch = amber border
- "Sync Aircraft" button on branch mismatch, "Update Aircraft" on version mismatch

---

## 6. Relevant Commits

| Commit | Description |
|--------|-------------|
| `d35587b` | CRITICAL: Fix boot loop - process accumulation + /tmp exhaustion |
| (this PR) | Branch-aware updates + storage safety + update UI |

## 7. File Index

### Shared Libraries (`shared/update/` — used by both RVR and Starnav)

| File | What it does |
|------|-------------|
| `shared/update/backend/update-lib.sh` | Core update: space check, shallow fetch, reset, submodule update, gc, web UI install, post-apply hook |
| `shared/update/backend/update-api.sh` | CGI handlers: update_devices, check_update, list_branches, get_update_log |
| `shared/update/backend/update-version.sh` | Version check with GitHub API, 10-min cache, anti-false-positive mtime logic |
| `shared/update/frontend/UpdateModal.tsx` | Branch selector + conditional device picker + progress log |
| `shared/update/frontend/UpdateBanner.tsx` | Persistent update notification with re-check callback |
| `shared/update/frontend/useUpdateState.ts` | Hook: update visibility latching, dismiss, post-update suppression |
| `shared/update/frontend/api.ts` | updateDevices(), checkUpdate(), listBranches() |
| `shared/update/frontend/types.ts` | VersionInfo, CheckUpdateResponse, BranchList, UpdateDevice |

### Project-Specific Files

| File | What it does |
|------|-------------|
| `robust_virtual_radio:cmd_update()` | Sources update-lib.sh, defines RVR hook (tap2tcp binary + bridge restart) |
| `robust_virtual_radio:cmd_branches()` | Sources update-lib.sh, calls update_list_branches_cli |
| `www-next/src/updateConfig.ts` | RVR config: project name, repo URL, device fetcher for multi-device updates |
| `install.sh` | Shallow fetch + submodule init on install, saves branch config |
| `www/cgi-bin/api.cgi` | Sources update-api.sh, routes update_devices/check_update/list_branches |
| `www/cgi-bin/status.cgi` | Sources update-version.sh for version tracking |
| `www/cgi-bin/discovery.cgi` | Exposes git_branch per device |
| `www-next/src/components/Header.tsx` | branch:hash display + check button (uses updateConfig.repoUrl) |
| `www-next/src/components/BindingManager.tsx` | Branch/version on peer cards + mismatch warnings |
