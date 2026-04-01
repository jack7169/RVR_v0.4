#!/bin/sh
#
# RVR Device Discovery Endpoint
# Returns this device's identity and service status as JSON.
# Probed by other RVR devices for peer discovery.
# VPN-agnostic — works over any routable IP network.
#

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, max-age=0"
echo ""

HOSTNAME=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown")
VERSION="4.0"
GIT_VERSION=$(cat /etc/rvr/version 2>/dev/null || echo "unknown")
GIT_BRANCH=$(cat /etc/rvr/branch 2>/dev/null || echo "main")

# Determine role from installed init scripts
ROLE="unknown"
[ -f /etc/init.d/kcptun-server ] && ROLE="gcs"
[ -f /etc/init.d/kcptun-client ] && ROLE="aircraft"

# Service status
KCPTUN_STATUS="stopped"
TAP2TCP_STATUS="stopped"
IFACE_STATUS="down"

if [ "$ROLE" = "gcs" ]; then
    pgrep -f kcptun-server >/dev/null 2>&1 && KCPTUN_STATUS="running"
else
    pgrep -f kcptun-client >/dev/null 2>&1 && KCPTUN_STATUS="running"
fi
pgrep tap2tcp >/dev/null 2>&1 && TAP2TCP_STATUS="running"
ip link show rvr_bridge >/dev/null 2>&1 && IFACE_STATUS="up"

# tap2tcp stats
TAP2TCP_STREAMS=0
TAP2TCP_FLOWS=0
if [ -f /tmp/tap2tcp.stats ]; then
    . /tmp/tap2tcp.stats
    TAP2TCP_STREAMS="${STREAMS:-0}"
    TAP2TCP_FLOWS="${FLOWS:-0}"
fi

# Uptime in seconds
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)

cat << EOF
{
  "hostname": "$HOSTNAME",
  "role": "$ROLE",
  "version": "$VERSION",
  "git_version": "$GIT_VERSION",
  "git_branch": "$GIT_BRANCH",
  "rvr_installed": true,
  "services": {
    "kcptun": "$KCPTUN_STATUS",
    "tap2tcp": "$TAP2TCP_STATUS",
    "rvr_bridge_interface": "$IFACE_STATUS"
  },
  "tap2tcp_streams": $TAP2TCP_STREAMS,
  "tap2tcp_flows": $TAP2TCP_FLOWS,
  "uptime": $UPTIME
}
EOF
