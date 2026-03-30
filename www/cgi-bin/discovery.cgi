#!/bin/sh
#
# L2Bridge Device Discovery Endpoint
# Returns this device's identity and service status as JSON.
# Probed by other l2bridge devices for peer discovery.
# VPN-agnostic — works over any routable IP network.
#

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, max-age=0"
echo ""

HOSTNAME=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown")
VERSION="4.0"
GIT_VERSION=$(cat /etc/l2bridge/version 2>/dev/null || echo "unknown")

# Determine role from installed init scripts
ROLE="unknown"
[ -f /etc/init.d/kcptun-server ] && ROLE="gcs"
[ -f /etc/init.d/kcptun-client ] && ROLE="aircraft"

# Service status
KCPTUN_STATUS="stopped"
L2TAP_STATUS="stopped"
IFACE_STATUS="down"

if [ "$ROLE" = "gcs" ]; then
    pgrep -f kcptun-server >/dev/null 2>&1 && KCPTUN_STATUS="running"
else
    pgrep -f kcptun-client >/dev/null 2>&1 && KCPTUN_STATUS="running"
fi
pgrep -f l2tap >/dev/null 2>&1 && L2TAP_STATUS="running"
ip link show l2bridge >/dev/null 2>&1 && IFACE_STATUS="up"

# l2tap stats
L2TAP_STREAMS=0
L2TAP_FLOWS=0
if [ -f /tmp/l2tap.stats ]; then
    . /tmp/l2tap.stats
    L2TAP_STREAMS="${STREAMS:-0}"
    L2TAP_FLOWS="${FLOWS:-0}"
fi

# Uptime in seconds
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)

cat << EOF
{
  "hostname": "$HOSTNAME",
  "role": "$ROLE",
  "version": "$VERSION",
  "git_version": "$GIT_VERSION",
  "l2bridge_installed": true,
  "services": {
    "kcptun": "$KCPTUN_STATUS",
    "l2tap": "$L2TAP_STATUS",
    "l2bridge_interface": "$IFACE_STATUS"
  },
  "l2tap_streams": $L2TAP_STREAMS,
  "l2tap_flows": $L2TAP_FLOWS,
  "uptime": $UPTIME
}
EOF
