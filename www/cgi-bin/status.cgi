#!/bin/sh
#
# RVR Web UI - Status API
# Returns JSON with GCS and aircraft status
#

echo "Content-Type: application/json"
echo "Cache-Control: no-cache"
echo ""

# Configuration
AIRCRAFT_FILE="/etc/rvr/aircraft.json"
STATE_FILE="/etc/rvr.conf"
HEALTH_FILE="/tmp/rvr.health"
SSH_KEY="/root/.ssh/id_dropbear"
CONNECTED_SINCE_FILE="/tmp/rvr.connected"

# Helper: escape string for JSON
json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' '
}

# Get GCS Tailscale IP
GCS_TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
GCS_TS_STATUS="disconnected"
if tailscale status >/dev/null 2>&1; then
    GCS_TS_STATUS="connected"
fi

# Check internet connectivity (fast, non-blocking)
INTERNET_STATUS="disconnected"
if ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then
    INTERNET_STATUS="connected"
fi

# Detect local role
LOCAL_ROLE="unknown"
[ -f /etc/init.d/kcptun-server ] && LOCAL_ROLE="gcs"
[ -f /etc/init.d/kcptun-client ] && LOCAL_ROLE="aircraft"

# Check local services (role-aware)
KCPTUN_STATUS="stopped"
if [ "$LOCAL_ROLE" = "gcs" ]; then
    pgrep -f kcptun-server >/dev/null 2>&1 && KCPTUN_STATUS="running"
elif [ "$LOCAL_ROLE" = "aircraft" ]; then
    pgrep -f kcptun-client >/dev/null 2>&1 && KCPTUN_STATUS="running"
else
    pgrep -f kcptun >/dev/null 2>&1 && KCPTUN_STATUS="running"
fi

TAP2TCP_STATUS="stopped"
pgrep tap2tcp >/dev/null 2>&1 && TAP2TCP_STATUS="running"

IFACE_STATUS="down"
IFACE_MTU="0"
if ip link show rvr_bridge >/dev/null 2>&1; then
    IFACE_STATUS="up"
    IFACE_MTU=$(ip link show rvr_bridge 2>/dev/null | grep -o 'mtu [0-9]*' | cut -d' ' -f2)
fi

# Get tap2tcp stats
TAP2TCP_STREAMS=0
TAP2TCP_MAX_STREAMS=32
TAP2TCP_FLOWS=0
TAP2TCP_BCAST="down"
TAP2TCP_TAP_RX_FRAMES=0
TAP2TCP_TAP_RX_BYTES=0
TAP2TCP_TAP_TX_FRAMES=0
TAP2TCP_TAP_TX_BYTES=0
if [ -f /tmp/tap2tcp.stats ]; then
    . /tmp/tap2tcp.stats
    TAP2TCP_STREAMS="${STREAMS:-0}"
    TAP2TCP_MAX_STREAMS="${MAX_STREAMS:-32}"
    TAP2TCP_FLOWS="${FLOWS:-0}"
    TAP2TCP_BCAST="${BCAST_STREAM:-down}"
    TAP2TCP_TAP_RX_FRAMES="${TAP_RX_FRAMES:-0}"
    TAP2TCP_TAP_RX_BYTES="${TAP_RX_BYTES:-0}"
    TAP2TCP_TAP_TX_FRAMES="${TAP_TX_FRAMES:-0}"
    TAP2TCP_TAP_TX_BYTES="${TAP_TX_BYTES:-0}"
    TAP2TCP_SOFT_DROPS="${SOFT_DROPS:-0}"
    TAP2TCP_HARD_DROPS="${HARD_DROPS:-0}"
    TAP2TCP_SEQ_DROPS="${SEQ_DROPS:-0}"
fi

# Check watchdog status
WATCHDOG_STATUS="inactive"
crontab -l 2>/dev/null | grep -q "rvr-watchdog" && WATCHDOG_STATUS="active"

# Read health file
HEALTH_STATUS="unknown"
HEALTH_LAST=""
HEALTH_DETAILS=""
if [ -f "$HEALTH_FILE" ]; then
    . "$HEALTH_FILE"
    HEALTH_STATUS="${STATUS:-unknown}"
    HEALTH_LAST="${LAST_CHECK:-}"
    HEALTH_DETAILS="${DETAILS:-}"
fi

# Get active aircraft from profiles
AIRCRAFT_ID=""
AIRCRAFT_NAME=""
AIRCRAFT_IP=""

if [ -f "$AIRCRAFT_FILE" ]; then
    if command -v jsonfilter >/dev/null 2>&1; then
        AIRCRAFT_ID=$(jsonfilter -i "$AIRCRAFT_FILE" -e '@.active' 2>/dev/null)
        if [ -n "$AIRCRAFT_ID" ]; then
            AIRCRAFT_NAME=$(jsonfilter -i "$AIRCRAFT_FILE" -e "@.profiles[\"$AIRCRAFT_ID\"].name" 2>/dev/null)
            AIRCRAFT_IP=$(jsonfilter -i "$AIRCRAFT_FILE" -e "@.profiles[\"$AIRCRAFT_ID\"].tailscale_ip" 2>/dev/null)
        fi
    else
        # Fallback: parse active profile with awk
        AIRCRAFT_ID=$(sed -n 's/.*"active"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$AIRCRAFT_FILE" | head -1)
        if [ -n "$AIRCRAFT_ID" ]; then
            AIRCRAFT_IP=$(awk -v id="$AIRCRAFT_ID" '
                /"'"$AIRCRAFT_ID"'"/ { found=1 }
                found && /"tailscale_ip"/ { gsub(/.*"tailscale_ip":[[:space:]]*"/, ""); gsub(/".*/, ""); print; exit }
            ' "$AIRCRAFT_FILE")
            AIRCRAFT_NAME=$(awk -v id="$AIRCRAFT_ID" '
                /"'"$AIRCRAFT_ID"'"/ { found=1 }
                found && /"name"/ { gsub(/.*"name":[[:space:]]*"/, ""); gsub(/".*/, ""); print; exit }
            ' "$AIRCRAFT_FILE")
        fi
    fi
fi

# Only fall back to legacy state if we found an active profile
# (prevents showing stale aircraft from failed bind attempts)
if [ -z "$AIRCRAFT_IP" ] && [ -n "$AIRCRAFT_ID" ] && [ -f "$STATE_FILE" ]; then
    . "$STATE_FILE"
    AIRCRAFT_IP="${AIRCRAFT_IP:-}"
    AIRCRAFT_NAME="${AIRCRAFT_NAME:-$AIRCRAFT_IP}"
fi

# Check aircraft status
AIRCRAFT_REACHABLE="false"
AIRCRAFT_KCPTUN="unknown"
AIRCRAFT_TAP2TCP="unknown"
AIRCRAFT_IFACE="unknown"
AIRCRAFT_GITVER="unknown"

if [ -n "$AIRCRAFT_IP" ]; then
    # Cache remote status for 10 seconds to prevent process storms at 1-3s polling
    REMOTE_CACHE="/tmp/rvr-remote-cache"
    CACHE_VALID=0
    if [ -f "$REMOTE_CACHE" ]; then
        CACHE_TS=$(head -1 "$REMOTE_CACHE" 2>/dev/null)
        CACHE_AGE=$(( NOW_S - ${CACHE_TS:-0} ))
        if [ "$CACHE_AGE" -lt 10 ]; then
            CACHE_VALID=1
            AIRCRAFT_REACHABLE=$(sed -n '2p' "$REMOTE_CACHE")
            AIRCRAFT_KCPTUN=$(sed -n '3p' "$REMOTE_CACHE")
            AIRCRAFT_TAP2TCP=$(sed -n '4p' "$REMOTE_CACHE")
            AIRCRAFT_IFACE=$(sed -n '5p' "$REMOTE_CACHE")
            AIRCRAFT_GITVER=$(sed -n '6p' "$REMOTE_CACHE")
            # Invalidate if local bridge is up but cached remote says down
            # (bridge came up after cache was written — stale data)
            if [ "$IFACE_STATUS" = "up" ] && [ "$AIRCRAFT_IFACE" = "down" ]; then
                CACHE_VALID=0
            fi
        fi
    fi

    if [ "$CACHE_VALID" -eq 0 ]; then
    # Quick ping check (1 second timeout)
    if ping -c 1 -W 1 "$AIRCRAFT_IP" >/dev/null 2>&1; then
        # Try discovery endpoint first (fast, no SSH overhead)
        DISC_JSON=$(wget -q -T 2 -O- "http://${AIRCRAFT_IP}:8081/cgi-bin/discovery.cgi" 2>/dev/null)
        if [ -n "$DISC_JSON" ]; then
            AIRCRAFT_KCPTUN=$(echo "$DISC_JSON" | sed -n 's/.*"kcptun"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
            AIRCRAFT_TAP2TCP=$(echo "$DISC_JSON" | sed -n 's/.*"tap2tcp"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
            AIRCRAFT_IFACE=$(echo "$DISC_JSON" | sed -n 's/.*"rvr_bridge_interface"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
            AIRCRAFT_GITVER=$(echo "$DISC_JSON" | sed -n 's/.*"git_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        elif [ -f "$SSH_KEY" ]; then
            # Fallback to SSH
            remote_kcptun_proc="kcptun-server"
            [ "$LOCAL_ROLE" = "gcs" ] && remote_kcptun_proc="kcptun-client"
            REMOTE_STATUS=$(timeout 5 dbclient -i "$SSH_KEY" -y root@"$AIRCRAFT_IP" "
                pgrep -f $remote_kcptun_proc >/dev/null && echo -n 'running ' || echo -n 'stopped '
                pgrep tap2tcp >/dev/null && echo -n 'running ' || echo -n 'stopped '
                ip link show rvr_bridge >/dev/null 2>&1 && echo 'up' || echo 'down'
            " 2>/dev/null)
            if [ -n "$REMOTE_STATUS" ]; then
                AIRCRAFT_KCPTUN=$(echo "$REMOTE_STATUS" | awk '{print $1}')
                AIRCRAFT_TAP2TCP=$(echo "$REMOTE_STATUS" | awk '{print $2}')
                AIRCRAFT_IFACE=$(echo "$REMOTE_STATUS" | awk '{print $3}')
            fi
        fi

        # Reachable = all critical services confirmed running
        if [ "$AIRCRAFT_KCPTUN" = "running" ] && [ "$AIRCRAFT_TAP2TCP" = "running" ] && [ "$AIRCRAFT_IFACE" = "up" ]; then
            AIRCRAFT_REACHABLE="true"
        fi
    fi
    # Write cache
    printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$NOW_S" "$AIRCRAFT_REACHABLE" "$AIRCRAFT_KCPTUN" "$AIRCRAFT_TAP2TCP" "$AIRCRAFT_IFACE" "$AIRCRAFT_GITVER" > "$REMOTE_CACHE"
    fi  # end CACHE_VALID check
fi

# Get VPN peer connection info for aircraft (VPN-agnostic via WireGuard stats)
TS_PEER_MODE="unknown"
TS_PEER_RELAY=""
TS_PEER_TX="0"
TS_PEER_RX="0"

if [ -n "$AIRCRAFT_IP" ]; then
    # Detect WG interface
    WG_IFACE=""
    for iface in tailscale0 wg0 wg1; do
        ip link show "$iface" >/dev/null 2>&1 && { WG_IFACE="$iface"; break; }
    done
    [ -z "$WG_IFACE" ] && WG_IFACE=$(ip -4 addr show | awk '/100\.[0-9]+\.[0-9]+\.[0-9]+/ { gsub(/.*dev /, ""); gsub(/ .*/, ""); print; exit }')

    # Try kernel WireGuard first
    if command -v wg >/dev/null 2>&1 && [ -n "$WG_IFACE" ]; then
        WG_PEER_LINE=$(wg show "$WG_IFACE" dump 2>/dev/null | awk -v ip="$AIRCRAFT_IP" '$4 ~ ip {print}')
        if [ -n "$WG_PEER_LINE" ]; then
            WG_HANDSHAKE=$(echo "$WG_PEER_LINE" | awk -F'	' '{print $5}')
            TS_PEER_RX=$(echo "$WG_PEER_LINE" | awk -F'	' '{print $6}')
            TS_PEER_TX=$(echo "$WG_PEER_LINE" | awk -F'	' '{print $7}')
            NOW=$(date +%s)
            if [ "$WG_HANDSHAKE" -gt 0 ] 2>/dev/null && [ $((NOW - WG_HANDSHAKE)) -lt 180 ]; then
                TS_PEER_MODE="direct"
            else
                TS_PEER_MODE="idle"
            fi
        fi
    fi

    # Fallback: VPN daemon local API (Tailscale/Headscale)
    if [ "$TS_PEER_MODE" = "unknown" ] && command -v curl >/dev/null 2>&1; then
        vpn_sock=""
        for s in /var/run/tailscale/tailscaled.sock /run/tailscale/tailscaled.sock; do
            [ -S "$s" ] && { vpn_sock="$s"; break; }
        done
        if [ -n "$vpn_sock" ]; then
            # Get full status, then extract the peer block containing our aircraft IP
            # The JSON has Peer map -> each peer has TailscaleIPs array
            # We grep for lines around the aircraft IP to find Relay/Online/RxBytes/TxBytes
            PEER_BLOCK=$(curl -s --max-time 2 --unix-socket "$vpn_sock" \
                "http://local-tailscaled.sock/localapi/v0/status" 2>/dev/null | \
                awk -v ip="$AIRCRAFT_IP" '
                    /\"'"$AIRCRAFT_IP"'\"/ { found=1 }
                    found { lines[NR] = $0 }
                    found && /\}/ && !/\{/ { for (i in lines) print lines[i]; exit }
                ')
            if [ -n "$PEER_BLOCK" ]; then
                # CurAddr is non-empty when direct (e.g. "1.2.3.4:41641"), empty when relayed.
                # Relay field persists the DERP region name even after upgrading to direct.
                PEER_CURADDR=$(echo "$PEER_BLOCK" | sed -n 's/.*"CurAddr"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
                PEER_RELAY=$(echo "$PEER_BLOCK" | sed -n 's/.*"Relay"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
                PEER_RX=$(echo "$PEER_BLOCK" | sed -n 's/.*"RxBytes"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
                PEER_TX=$(echo "$PEER_BLOCK" | sed -n 's/.*"TxBytes"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')

                [ -n "$PEER_RX" ] && TS_PEER_RX="$PEER_RX"
                [ -n "$PEER_TX" ] && TS_PEER_TX="$PEER_TX"

                if [ -n "$PEER_CURADDR" ]; then
                    TS_PEER_MODE="direct"
                elif [ -n "$PEER_RELAY" ]; then
                    TS_PEER_MODE="relay"
                    TS_PEER_RELAY="$PEER_RELAY"
                else
                    TS_PEER_MODE="direct"
                fi
            fi
        fi
    fi

    # Last resort: if aircraft is reachable, call it direct
    if [ "$TS_PEER_MODE" = "unknown" ] && [ "$AIRCRAFT_REACHABLE" = "true" ]; then
        TS_PEER_MODE="direct"
    fi
fi

# Determine connection status
CONNECTION_ESTABLISHED="false"
CONNECTION_DURATION=0

# Connection requires: local kcptun + tap2tcp running + remote peer reachable
# Reset uptime when connection drops, restart when it comes back
if [ "$KCPTUN_STATUS" = "running" ] && [ "$TAP2TCP_STATUS" = "running" ] && \
   [ "$IFACE_STATUS" = "up" ] && [ "$AIRCRAFT_REACHABLE" = "true" ]; then
    CONNECTION_ESTABLISHED="true"
    if [ ! -f "$CONNECTED_SINCE_FILE" ]; then
        date +%s > "$CONNECTED_SINCE_FILE"
    fi
    CONNECTED_SINCE=$(cat "$CONNECTED_SINCE_FILE" 2>/dev/null)
    NOW=$(date +%s)
    CONNECTION_DURATION=$((NOW - CONNECTED_SINCE))
elif [ "$KCPTUN_STATUS" = "running" ] && [ "$TAP2TCP_STATUS" = "running" ] && \
     [ "$IFACE_STATUS" = "up" ]; then
    # Services up but remote unreachable — keep connected status briefly (may be transient)
    if [ -f "$CONNECTED_SINCE_FILE" ]; then
        CONNECTION_ESTABLISHED="true"
        CONNECTED_SINCE=$(cat "$CONNECTED_SINCE_FILE" 2>/dev/null)
        NOW=$(date +%s)
        CONNECTION_DURATION=$((NOW - CONNECTED_SINCE))
    fi
else
    # Services down — reset connection tracking
    rm -f "$CONNECTED_SINCE_FILE" 2>/dev/null
fi

# Network statistics for rvr_bridge interface
RVR_B_STATS_DIR="/sys/class/net/rvr_bridge/statistics"
RVR_B_RX_BYTES=0
RVR_B_TX_BYTES=0
RVR_B_RX_PACKETS=0
RVR_B_TX_PACKETS=0
RVR_B_RX_ERRORS=0
RVR_B_TX_ERRORS=0
RVR_B_RX_DROPPED=0
RVR_B_TX_DROPPED=0
RVR_B_MULTICAST=0

if [ -d "$RVR_B_STATS_DIR" ]; then
    RVR_B_RX_BYTES=$(cat "$RVR_B_STATS_DIR/rx_bytes" 2>/dev/null || echo 0)
    RVR_B_TX_BYTES=$(cat "$RVR_B_STATS_DIR/tx_bytes" 2>/dev/null || echo 0)
    RVR_B_RX_PACKETS=$(cat "$RVR_B_STATS_DIR/rx_packets" 2>/dev/null || echo 0)
    RVR_B_TX_PACKETS=$(cat "$RVR_B_STATS_DIR/tx_packets" 2>/dev/null || echo 0)
    RVR_B_RX_ERRORS=$(cat "$RVR_B_STATS_DIR/rx_errors" 2>/dev/null || echo 0)
    RVR_B_TX_ERRORS=$(cat "$RVR_B_STATS_DIR/tx_errors" 2>/dev/null || echo 0)
    RVR_B_RX_DROPPED=$(cat "$RVR_B_STATS_DIR/rx_dropped" 2>/dev/null || echo 0)
    RVR_B_TX_DROPPED=$(cat "$RVR_B_STATS_DIR/tx_dropped" 2>/dev/null || echo 0)
    RVR_B_MULTICAST=$(cat "$RVR_B_STATS_DIR/multicast" 2>/dev/null || echo 0)
fi

# WAN interface statistics (actual Starlink-facing traffic)
WAN_IFACE=$(ip route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -1)
WAN_IFACE="${WAN_IFACE:-eth0}"
WAN_STATS_DIR="/sys/class/net/$WAN_IFACE/statistics"
WAN_RX_BYTES=0
WAN_TX_BYTES=0
WAN_RX_PACKETS=0
WAN_TX_PACKETS=0

if [ -d "$WAN_STATS_DIR" ]; then
    WAN_RX_BYTES=$(cat "$WAN_STATS_DIR/rx_bytes" 2>/dev/null || echo 0)
    WAN_TX_BYTES=$(cat "$WAN_STATS_DIR/tx_bytes" 2>/dev/null || echo 0)
    WAN_RX_PACKETS=$(cat "$WAN_STATS_DIR/rx_packets" 2>/dev/null || echo 0)
    WAN_TX_PACKETS=$(cat "$WAN_STATS_DIR/tx_packets" 2>/dev/null || echo 0)
fi

# Get current timestamp in milliseconds for rate calculation
# BusyBox date doesn't support %3N — always compute ms from seconds
STATS_TIMESTAMP=$(($(date +%s) * 1000))

# Append to rolling stats history — throttled to max 1 write per 3 seconds
# Prevents /tmp exhaustion when UI polls at 1-3s intervals with multiple tabs
STATS_HISTORY="/tmp/rvr-stats.csv"
STATS_LAST="/tmp/rvr-stats-last"
NOW_S=$(date +%s)
LAST_WRITE=$(cat "$STATS_LAST" 2>/dev/null || echo 0)
if [ $((NOW_S - LAST_WRITE)) -ge 3 ]; then
    echo "$STATS_TIMESTAMP|$RVR_B_RX_BYTES|$RVR_B_TX_BYTES|$RVR_B_RX_PACKETS|$RVR_B_TX_PACKETS|$RVR_B_RX_ERRORS|$RVR_B_TX_ERRORS|$((RVR_B_RX_DROPPED + RVR_B_TX_DROPPED))|$WAN_RX_BYTES|$WAN_TX_BYTES" >> "$STATS_HISTORY" 2>/dev/null
    echo "$NOW_S" > "$STATS_LAST"
    # Inline rotation — cap at 8640 lines (~7.2h at 3s throttle)
    if [ "$(wc -l < "$STATS_HISTORY" 2>/dev/null || echo 0)" -gt 8640 ]; then
        tail -8640 "$STATS_HISTORY" > "${STATS_HISTORY}.tmp" && mv "${STATS_HISTORY}.tmp" "$STATS_HISTORY"
    fi
fi

# Bridge filter stats (nftables counters)
FILTER_ACTIVE="false"
FILTER_DROPPED_PKTS=0
FILTER_DROPPED_BYTES=0
if nft list table bridge rvr_filter >/dev/null 2>&1; then
    FILTER_ACTIVE="true"
    FILTER_STATS=$(nft list chain bridge rvr_filter forward 2>/dev/null)
    # Sum counters from both drop rules
    FILTER_DROPPED_PKTS=$(echo "$FILTER_STATS" | grep "counter" | grep "drop" | sed 's/.*packets \([0-9]*\).*/\1/' | awk '{s+=$1} END {print s+0}')
    FILTER_DROPPED_BYTES=$(echo "$FILTER_STATS" | grep "counter" | grep "drop" | sed 's/.*bytes \([0-9]*\).*/\1/' | awk '{s+=$1} END {print s+0}')
fi

# Capture status
CAPTURE_ACTIVE="false"
CAPTURE_ELAPSED=0
CAPTURE_FILE_SIZE=0
CAPTURE_PID_FILE="/tmp/rvr-capture.pid"
CAPTURE_START_FILE="/tmp/rvr-capture.start"
CAPTURE_FILE="/tmp/rvr-capture.pcap"
if [ -f "$CAPTURE_PID_FILE" ]; then
    CAPTURE_PID=$(cat "$CAPTURE_PID_FILE")
    if kill -0 "$CAPTURE_PID" 2>/dev/null; then
        CAPTURE_ACTIVE="true"
        if [ -f "$CAPTURE_START_FILE" ]; then
            CAPTURE_START=$(cat "$CAPTURE_START_FILE")
            CAPTURE_ELAPSED=$(( $(date +%s) - CAPTURE_START ))
        fi
    else
        rm -f "$CAPTURE_PID_FILE"
    fi
fi
[ -f "$CAPTURE_FILE" ] && CAPTURE_FILE_SIZE=$(wc -c < "$CAPTURE_FILE" 2>/dev/null || echo 0)

# Storage info
OVERLAY_TOTAL=$(df /overlay 2>/dev/null | tail -1 | awk '{print $2}')
OVERLAY_USED=$(df /overlay 2>/dev/null | tail -1 | awk '{print $3}')
OVERLAY_FREE=$(df /overlay 2>/dev/null | tail -1 | awk '{print $4}')
MEM_TOTAL=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)
MEM_AVAILABLE=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null)

# Version tracking
VERSION_CURRENT=$(cat /etc/rvr/version 2>/dev/null || echo "unknown")
VERSION_BRANCH=$(cat /etc/rvr/branch 2>/dev/null || echo "main")
VERSION_LATEST=""
VERSION_UPDATE="false"
REPO_PATH=$(cat /etc/rvr/repo 2>/dev/null || echo "")
[ -z "$REPO_PATH" ] && REPO_PATH="jack7169/RVR_v0.4"

if [ -n "$REPO_PATH" ] && [ "$VERSION_CURRENT" != "unknown" ]; then
    CACHE_FILE="/tmp/rvr-latest-version"
    CACHE_AGE=600  # 10 minutes
    # Use cached value if fresh enough
    if [ -f "$CACHE_FILE" ]; then
        FILE_AGE=$(( $(date +%s) - $(date -r "$CACHE_FILE" +%s 2>/dev/null || echo 0) ))
        if [ "$FILE_AGE" -lt "$CACHE_AGE" ]; then
            VERSION_LATEST=$(cat "$CACHE_FILE" 2>/dev/null || echo "")
        fi
    fi
    # Fetch from GitHub if cache miss (with 3s timeout to avoid blocking CGI)
    if [ -z "$VERSION_LATEST" ]; then
        VERSION_LATEST=$(wget -q -T 3 -O- "https://api.github.com/repos/$REPO_PATH/commits/$VERSION_BRANCH" 2>/dev/null | awk -F'"' '/"sha"/ {print substr($4,1,7); exit}')
        if [ -n "$VERSION_LATEST" ]; then
            echo "$VERSION_LATEST" > "$CACHE_FILE"
        fi
    fi
    # Only show update if latest differs from current AND version file is older than cache
    # This prevents false positives when we just updated (version file is newer than cache)
    if [ -n "$VERSION_LATEST" ] && [ "$VERSION_LATEST" != "$VERSION_CURRENT" ]; then
        VERSION_FILE="/etc/rvr/version"
        if [ -f "$CACHE_FILE" ] && [ -f "$VERSION_FILE" ]; then
            CACHE_MTIME=$(date -r "$CACHE_FILE" +%s 2>/dev/null || echo 0)
            VERSION_MTIME=$(date -r "$VERSION_FILE" +%s 2>/dev/null || echo 0)
            # If version file is newer than cache, we just updated — stale cache
            if [ "$VERSION_MTIME" -gt "$CACHE_MTIME" ]; then
                rm -f "$CACHE_FILE"
                VERSION_LATEST="$VERSION_CURRENT"
            else
                VERSION_UPDATE="true"
            fi
        else
            VERSION_UPDATE="true"
        fi
    fi
fi

# Output JSON response
cat << EOF
{
  "timestamp": "$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')",
  "role": "$LOCAL_ROLE",
  "gcs": {
    "tailscale_ip": "${GCS_TS_IP:-}",
    "tailscale_status": "$GCS_TS_STATUS",
    "services": {
      "kcptun_server": "$KCPTUN_STATUS",
      "tap2tcp": "$TAP2TCP_STATUS",
      "rvr_bridge_interface": "$IFACE_STATUS"
    },
    "interface": {
      "name": "rvr_bridge",
      "mtu": ${IFACE_MTU:-0},
      "state": "$IFACE_STATUS"
    },
    "tap2tcp_streams": {
      "active": $TAP2TCP_STREAMS,
      "max": $TAP2TCP_MAX_STREAMS,
      "flows": $TAP2TCP_FLOWS,
      "broadcast_stream": "$TAP2TCP_BCAST",
      "tap_rx_frames": $TAP2TCP_TAP_RX_FRAMES,
      "tap_rx_bytes": $TAP2TCP_TAP_RX_BYTES,
      "tap_tx_frames": $TAP2TCP_TAP_TX_FRAMES,
      "tap_tx_bytes": $TAP2TCP_TAP_TX_BYTES,
      "soft_drops": ${TAP2TCP_SOFT_DROPS:-0},
      "hard_drops": ${TAP2TCP_HARD_DROPS:-0},
      "seq_drops": ${TAP2TCP_SEQ_DROPS:-0}
    },
    "watchdog": "$WATCHDOG_STATUS",
    "health": {
      "status": "$HEALTH_STATUS",
      "last_check": "$HEALTH_LAST",
      "details": "$(json_escape "$HEALTH_DETAILS")"
    }
  },
  "aircraft": {
    "id": "${AIRCRAFT_ID:-}",
    "profile_name": "${AIRCRAFT_NAME:-None}",
    "tailscale_ip": "${AIRCRAFT_IP:-}",
    "reachable": $AIRCRAFT_REACHABLE,
    "tailscale_peer": {
      "mode": "$TS_PEER_MODE",
      "relay": "${TS_PEER_RELAY:-}",
      "rx_bytes": ${TS_PEER_RX:-0},
      "tx_bytes": ${TS_PEER_TX:-0}
    },
    "services": {
      "kcptun_client": "$AIRCRAFT_KCPTUN",
      "tap2tcp": "$AIRCRAFT_TAP2TCP",
      "rvr_bridge_interface": "$AIRCRAFT_IFACE"
    },
    "git_version": "$AIRCRAFT_GITVER"
  },
  "connection": {
    "established": $CONNECTION_ESTABLISHED,
    "duration_seconds": $CONNECTION_DURATION
  },
  "network_stats": {
    "timestamp_ms": $STATS_TIMESTAMP,
    "rvr_bridge": {
      "rx_bytes": $RVR_B_RX_BYTES,
      "tx_bytes": $RVR_B_TX_BYTES,
      "rx_packets": $RVR_B_RX_PACKETS,
      "tx_packets": $RVR_B_TX_PACKETS,
      "rx_errors": $RVR_B_RX_ERRORS,
      "tx_errors": $RVR_B_TX_ERRORS,
      "rx_dropped": $RVR_B_RX_DROPPED,
      "tx_dropped": $RVR_B_TX_DROPPED,
      "multicast": $RVR_B_MULTICAST
    },
    "wan": {
      "interface": "$WAN_IFACE",
      "rx_bytes": $WAN_RX_BYTES,
      "tx_bytes": $WAN_TX_BYTES,
      "rx_packets": $WAN_RX_PACKETS,
      "tx_packets": $WAN_TX_PACKETS
    }
  },
  "internet": {
    "status": "$INTERNET_STATUS"
  },
  "bridge_filter": {
    "active": $FILTER_ACTIVE,
    "dropped_packets": $FILTER_DROPPED_PKTS,
    "dropped_bytes": $FILTER_DROPPED_BYTES
  },
  "capture": {
    "active": $CAPTURE_ACTIVE,
    "elapsed": ${CAPTURE_ELAPSED:-0},
    "file_size": $CAPTURE_FILE_SIZE
  },
  "version": {
    "current": "$VERSION_CURRENT",
    "latest": "$VERSION_LATEST",
    "branch": "$VERSION_BRANCH",
    "update_available": $VERSION_UPDATE
  },
  "system": {
    "overlay_total_kb": ${OVERLAY_TOTAL:-0},
    "overlay_used_kb": ${OVERLAY_USED:-0},
    "overlay_free_kb": ${OVERLAY_FREE:-0},
    "mem_total_kb": ${MEM_TOTAL:-0},
    "mem_available_kb": ${MEM_AVAILABLE:-0}
  }
}
EOF
