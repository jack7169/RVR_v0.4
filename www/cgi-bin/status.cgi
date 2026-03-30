#!/bin/sh
#
# L2Bridge Web UI - Status API
# Returns JSON with GCS and aircraft status
#

echo "Content-Type: application/json"
echo "Cache-Control: no-cache"
echo ""

# Configuration
AIRCRAFT_FILE="/etc/l2bridge/aircraft.json"
STATE_FILE="/etc/l2bridge.conf"
HEALTH_FILE="/tmp/l2bridge.health"
SSH_KEY="/root/.ssh/id_dropbear"
CONNECTED_SINCE_FILE="/tmp/l2bridge.connected"

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

# Check local services
KCPTUN_STATUS="stopped"
pgrep -f kcptun-server >/dev/null 2>&1 && KCPTUN_STATUS="running"

L2TAP_STATUS="stopped"
pgrep -f l2tap >/dev/null 2>&1 && L2TAP_STATUS="running"

IFACE_STATUS="down"
IFACE_MTU="0"
if ip link show l2bridge >/dev/null 2>&1; then
    IFACE_STATUS="up"
    IFACE_MTU=$(ip link show l2bridge 2>/dev/null | grep -o 'mtu [0-9]*' | cut -d' ' -f2)
fi

# Get l2tap stats
L2TAP_STREAMS=0
L2TAP_MAX_STREAMS=32
L2TAP_FLOWS=0
L2TAP_BCAST="down"
L2TAP_TAP_RX_FRAMES=0
L2TAP_TAP_RX_BYTES=0
L2TAP_TAP_TX_FRAMES=0
L2TAP_TAP_TX_BYTES=0
if [ -f /tmp/l2tap.stats ]; then
    . /tmp/l2tap.stats
    L2TAP_STREAMS="${STREAMS:-0}"
    L2TAP_MAX_STREAMS="${MAX_STREAMS:-32}"
    L2TAP_FLOWS="${FLOWS:-0}"
    L2TAP_BCAST="${BCAST_STREAM:-down}"
    L2TAP_TAP_RX_FRAMES="${TAP_RX_FRAMES:-0}"
    L2TAP_TAP_RX_BYTES="${TAP_RX_BYTES:-0}"
    L2TAP_TAP_TX_FRAMES="${TAP_TX_FRAMES:-0}"
    L2TAP_TAP_TX_BYTES="${TAP_TX_BYTES:-0}"
fi

# Check watchdog status
WATCHDOG_STATUS="inactive"
crontab -l 2>/dev/null | grep -q "l2bridge-watchdog" && WATCHDOG_STATUS="active"

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

# Get active aircraft from profiles or legacy config
AIRCRAFT_ID=""
AIRCRAFT_NAME=""
AIRCRAFT_IP=""

if [ -f "$AIRCRAFT_FILE" ]; then
    # Use jsonfilter if available, otherwise parse manually
    if command -v jsonfilter >/dev/null 2>&1; then
        AIRCRAFT_ID=$(jsonfilter -i "$AIRCRAFT_FILE" -e '@.active' 2>/dev/null)
        if [ -n "$AIRCRAFT_ID" ]; then
            AIRCRAFT_NAME=$(jsonfilter -i "$AIRCRAFT_FILE" -e "@.profiles[\"$AIRCRAFT_ID\"].name" 2>/dev/null)
            AIRCRAFT_IP=$(jsonfilter -i "$AIRCRAFT_FILE" -e "@.profiles[\"$AIRCRAFT_ID\"].tailscale_ip" 2>/dev/null)
        fi
    fi
fi

# Fallback to legacy config
if [ -z "$AIRCRAFT_IP" ] && [ -f "$STATE_FILE" ]; then
    . "$STATE_FILE"
    AIRCRAFT_IP="${AIRCRAFT_IP:-}"
    AIRCRAFT_NAME="${AIRCRAFT_NAME:-$AIRCRAFT_IP}"
fi

# Check aircraft status
AIRCRAFT_REACHABLE="false"
AIRCRAFT_KCPTUN="unknown"
AIRCRAFT_L2TAP="unknown"
AIRCRAFT_IFACE="unknown"

if [ -n "$AIRCRAFT_IP" ]; then
    # Quick ping check (1 second timeout)
    if ping -c 1 -W 1 "$AIRCRAFT_IP" >/dev/null 2>&1; then
        AIRCRAFT_REACHABLE="true"

        # SSH check for detailed status (only if key exists and ping succeeded)
        if [ -f "$SSH_KEY" ]; then
            REMOTE_STATUS=$(timeout 5 dbclient -i "$SSH_KEY" -y root@"$AIRCRAFT_IP" '
                pgrep -f kcptun-client >/dev/null && echo -n "running " || echo -n "stopped "
                pgrep -f l2tap >/dev/null && echo -n "running " || echo -n "stopped "
                ip link show l2bridge >/dev/null 2>&1 && echo "up" || echo "down"
            ' 2>/dev/null)

            if [ -n "$REMOTE_STATUS" ]; then
                AIRCRAFT_KCPTUN=$(echo "$REMOTE_STATUS" | awk '{print $1}')
                AIRCRAFT_L2TAP=$(echo "$REMOTE_STATUS" | awk '{print $2}')
                AIRCRAFT_IFACE=$(echo "$REMOTE_STATUS" | awk '{print $3}')
            fi
        fi
    fi
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

    # Parse WG stats for this peer
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
fi

# Determine connection status
CONNECTION_ESTABLISHED="false"
CONNECTION_DURATION=0

if [ "$KCPTUN_STATUS" = "running" ] && [ "$L2TAP_STATUS" = "running" ] && \
   [ "$IFACE_STATUS" = "up" ] 2>/dev/null; then
    CONNECTION_ESTABLISHED="true"

    # Track connection start time
    if [ ! -f "$CONNECTED_SINCE_FILE" ]; then
        date +%s > "$CONNECTED_SINCE_FILE"
    fi
    CONNECTED_SINCE=$(cat "$CONNECTED_SINCE_FILE" 2>/dev/null)
    NOW=$(date +%s)
    CONNECTION_DURATION=$((NOW - CONNECTED_SINCE))
else
    # Clear connection tracking if not connected
    rm -f "$CONNECTED_SINCE_FILE" 2>/dev/null
fi

# Network statistics for l2bridge interface
L2B_STATS_DIR="/sys/class/net/l2bridge/statistics"
L2B_RX_BYTES=0
L2B_TX_BYTES=0
L2B_RX_PACKETS=0
L2B_TX_PACKETS=0
L2B_RX_ERRORS=0
L2B_TX_ERRORS=0
L2B_RX_DROPPED=0
L2B_TX_DROPPED=0
L2B_MULTICAST=0

if [ -d "$L2B_STATS_DIR" ]; then
    L2B_RX_BYTES=$(cat "$L2B_STATS_DIR/rx_bytes" 2>/dev/null || echo 0)
    L2B_TX_BYTES=$(cat "$L2B_STATS_DIR/tx_bytes" 2>/dev/null || echo 0)
    L2B_RX_PACKETS=$(cat "$L2B_STATS_DIR/rx_packets" 2>/dev/null || echo 0)
    L2B_TX_PACKETS=$(cat "$L2B_STATS_DIR/tx_packets" 2>/dev/null || echo 0)
    L2B_RX_ERRORS=$(cat "$L2B_STATS_DIR/rx_errors" 2>/dev/null || echo 0)
    L2B_TX_ERRORS=$(cat "$L2B_STATS_DIR/tx_errors" 2>/dev/null || echo 0)
    L2B_RX_DROPPED=$(cat "$L2B_STATS_DIR/rx_dropped" 2>/dev/null || echo 0)
    L2B_TX_DROPPED=$(cat "$L2B_STATS_DIR/tx_dropped" 2>/dev/null || echo 0)
    L2B_MULTICAST=$(cat "$L2B_STATS_DIR/multicast" 2>/dev/null || echo 0)
fi

# Tailscale interface statistics (for WAN traffic comparison)
TS_IFACE=$(ip route get 100.64.0.1 2>/dev/null | grep -oE 'dev [^ ]+' | awk '{print $2}' | head -1)
TS_IFACE="${TS_IFACE:-tailscale0}"
TS_STATS_DIR="/sys/class/net/$TS_IFACE/statistics"
TS_RX_BYTES=0
TS_TX_BYTES=0
TS_RX_PACKETS=0
TS_TX_PACKETS=0

if [ -d "$TS_STATS_DIR" ]; then
    TS_RX_BYTES=$(cat "$TS_STATS_DIR/rx_bytes" 2>/dev/null || echo 0)
    TS_TX_BYTES=$(cat "$TS_STATS_DIR/tx_bytes" 2>/dev/null || echo 0)
    TS_RX_PACKETS=$(cat "$TS_STATS_DIR/rx_packets" 2>/dev/null || echo 0)
    TS_TX_PACKETS=$(cat "$TS_STATS_DIR/tx_packets" 2>/dev/null || echo 0)
fi

# Get current timestamp in milliseconds for rate calculation
STATS_TIMESTAMP=$(date +%s%3N 2>/dev/null || echo $(($(date +%s) * 1000)))

# Bridge filter stats (nftables counters)
FILTER_ACTIVE="false"
FILTER_DROPPED_PKTS=0
FILTER_DROPPED_BYTES=0
if nft list table bridge l2bridge_filter >/dev/null 2>&1; then
    FILTER_ACTIVE="true"
    FILTER_STATS=$(nft list chain bridge l2bridge_filter forward 2>/dev/null)
    # Sum counters from both drop rules
    FILTER_DROPPED_PKTS=$(echo "$FILTER_STATS" | grep "counter" | grep "drop" | sed 's/.*packets \([0-9]*\).*/\1/' | awk '{s+=$1} END {print s+0}')
    FILTER_DROPPED_BYTES=$(echo "$FILTER_STATS" | grep "counter" | grep "drop" | sed 's/.*bytes \([0-9]*\).*/\1/' | awk '{s+=$1} END {print s+0}')
fi

# Capture status
CAPTURE_ACTIVE="false"
CAPTURE_ELAPSED=0
CAPTURE_FILE_SIZE=0
CAPTURE_PID_FILE="/tmp/l2bridge-capture.pid"
CAPTURE_START_FILE="/tmp/l2bridge-capture.start"
CAPTURE_FILE="/tmp/l2bridge-capture.pcap"
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

# Version tracking
VERSION_CURRENT=$(cat /etc/l2bridge/version 2>/dev/null || echo "unknown")
VERSION_LATEST=""
VERSION_UPDATE="false"
REPO_PATH=$(cat /etc/l2bridge/repo 2>/dev/null || echo "")

if [ -n "$REPO_PATH" ] && [ "$VERSION_CURRENT" != "unknown" ]; then
    CACHE_FILE="/tmp/l2bridge-latest-version"
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
        VERSION_LATEST=$(wget -q -T 3 -O- "https://api.github.com/repos/$REPO_PATH/commits/main" 2>/dev/null | awk -F'"' '/"sha"/ {print substr($4,1,7); exit}')
        if [ -n "$VERSION_LATEST" ]; then
            echo "$VERSION_LATEST" > "$CACHE_FILE"
        fi
    fi
    # Only show update if latest differs from current AND version file is older than cache
    # This prevents false positives when we just updated (version file is newer than cache)
    if [ -n "$VERSION_LATEST" ] && [ "$VERSION_LATEST" != "$VERSION_CURRENT" ]; then
        VERSION_FILE="/etc/l2bridge/version"
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
  "gcs": {
    "tailscale_ip": "${GCS_TS_IP:-}",
    "tailscale_status": "$GCS_TS_STATUS",
    "services": {
      "kcptun_server": "$KCPTUN_STATUS",
      "l2tap": "$L2TAP_STATUS",
      "l2bridge_interface": "$IFACE_STATUS"
    },
    "interface": {
      "name": "l2bridge",
      "mtu": ${IFACE_MTU:-0},
      "state": "$IFACE_STATUS"
    },
    "l2tap_streams": {
      "active": $L2TAP_STREAMS,
      "max": $L2TAP_MAX_STREAMS,
      "flows": $L2TAP_FLOWS,
      "broadcast_stream": "$L2TAP_BCAST",
      "tap_rx_frames": $L2TAP_TAP_RX_FRAMES,
      "tap_rx_bytes": $L2TAP_TAP_RX_BYTES,
      "tap_tx_frames": $L2TAP_TAP_TX_FRAMES,
      "tap_tx_bytes": $L2TAP_TAP_TX_BYTES
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
      "l2tap": "$AIRCRAFT_L2TAP",
      "l2bridge_interface": "$AIRCRAFT_IFACE"
    }
  },
  "connection": {
    "established": $CONNECTION_ESTABLISHED,
    "duration_seconds": $CONNECTION_DURATION
  },
  "network_stats": {
    "timestamp_ms": $STATS_TIMESTAMP,
    "l2bridge": {
      "rx_bytes": $L2B_RX_BYTES,
      "tx_bytes": $L2B_TX_BYTES,
      "rx_packets": $L2B_RX_PACKETS,
      "tx_packets": $L2B_TX_PACKETS,
      "rx_errors": $L2B_RX_ERRORS,
      "tx_errors": $L2B_TX_ERRORS,
      "rx_dropped": $L2B_RX_DROPPED,
      "tx_dropped": $L2B_TX_DROPPED,
      "multicast": $L2B_MULTICAST
    },
    "tailscale": {
      "interface": "$TS_IFACE",
      "rx_bytes": $TS_RX_BYTES,
      "tx_bytes": $TS_TX_BYTES,
      "rx_packets": $TS_RX_PACKETS,
      "tx_packets": $TS_TX_PACKETS
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
    "update_available": $VERSION_UPDATE
  }
}
EOF
