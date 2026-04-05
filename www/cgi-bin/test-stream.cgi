#!/bin/sh
#
# RVR Web UI - Speedtest / Packet Storm SSE Streaming
# Streams test results phase-by-phase via Server-Sent Events
#

SSH_KEY="/root/.ssh/id_dropbear"

# ── Helpers ──────────────────────────────────────────────────────────────

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/\r//g'
}

send_phase() {
    local phase="$1"
    local output="$2"
    local escaped=$(json_escape "$output")
    echo "data: {\"phase\": \"$phase\", \"output\": \"$escaped\"}"
    echo ""
}

send_done() {
    echo "event: done"
    echo "data: {}"
    echo ""
}

send_error() {
    echo "event: error"
    local escaped=$(json_escape "$1")
    echo "data: {\"error\": \"$escaped\"}"
    echo ""
}

_ssh_remote() {
    local ip="$1"; shift
    timeout 120 dbclient -i "$SSH_KEY" -y root@"$ip" "$@" 2>/dev/null
}

_get_bridge_ip() {
    local vpn_ip="$1"
    _ssh_remote "$vpn_ip" "ip -4 addr show br-lan 2>/dev/null | awk '/inet / {split(\$2,a,\"/\"); print a[1]; exit}'"
}

# ── Parse query string ───────────────────────────────────────────────────

action=""
ip=""
# QUERY_STRING is set by uhttpd for GET requests
for param in $(echo "$QUERY_STRING" | tr '&' ' '); do
    key=$(echo "$param" | cut -d= -f1)
    val=$(echo "$param" | cut -d= -f2-)
    case "$key" in
        action) action="$val" ;;
        ip)     ip="$val" ;;
    esac
done

# ── SSE headers ──────────────────────────────────────────────────────────

echo "Content-Type: text/event-stream"
echo "Cache-Control: no-cache"
echo "Connection: keep-alive"
echo "X-Accel-Buffering: no"
echo ""

# ── Validation ───────────────────────────────────────────────────────────

if [ -z "$action" ] || [ -z "$ip" ]; then
    send_error "Missing action or ip parameter"
    exit 0
fi

case "$action" in
    speedtest|packet_storm) ;;
    *) send_error "Unknown action: $action"; exit 0 ;;
esac

command -v iperf3 >/dev/null 2>&1 || { send_error "iperf3 not installed"; exit 0; }
[ -f "$SSH_KEY" ] || { send_error "SSH key not available"; exit 0; }

# ── Safety: auto-kill after 2 minutes ────────────────────────────────────

(sleep 120; kill -TERM $$ 2>/dev/null; sleep 2; kill -KILL $$ 2>/dev/null) &
TIMEOUT_PID=$!

cleanup() {
    kill $TIMEOUT_PID 2>/dev/null
    _ssh_remote "$ip" "killall iperf3 2>/dev/null" &
    for pid in $(jobs -p 2>/dev/null); do
        kill "$pid" 2>/dev/null
    done
    exit 0
}
trap cleanup EXIT INT TERM HUP

# ── Resolve bridge IP ───────────────────────────────────────────────────

bridge_ip=$(_get_bridge_ip "$ip")
if [ -z "$bridge_ip" ]; then
    send_phase "setup" "WARNING: Could not get aircraft br-lan IP. Bridge may not be forwarding.\nFalling back to VPN IP (bypasses tap2tcp/kcptun)."
    bridge_ip="$ip"
else
    send_phase "setup" "Testing through L2 bridge: $bridge_ip (not VPN direct)"
fi

# ── Run test ─────────────────────────────────────────────────────────────

if [ "$action" = "speedtest" ]; then

    # Latency
    output=$(ping -c 5 -W 2 "$bridge_ip" 2>&1 | tail -2)
    send_phase "latency" "=== Latency (5 pings via bridge) ===\n$output"

    # TCP throughput
    _ssh_remote "$ip" "killall iperf3 2>/dev/null; iperf3 -s -B $bridge_ip -D -1"
    sleep 1
    output=$(iperf3 -c "$bridge_ip" -t 10 2>&1)
    send_phase "tcp" "=== TCP Throughput (10s via bridge) ===\n$output"

    # UDP throughput
    _ssh_remote "$ip" "killall iperf3 2>/dev/null; iperf3 -s -B $bridge_ip -D -1"
    sleep 1
    output=$(iperf3 -c "$bridge_ip" -t 10 -u -b 50M 2>&1)
    send_phase "udp" "=== UDP Throughput (10s, 50Mbps via bridge) ===\n$output"

    _ssh_remote "$ip" "killall iperf3 2>/dev/null"

    # Tap2TCP stats
    if [ -f /tmp/tap2tcp.stats ]; then
        . /tmp/tap2tcp.stats
        send_phase "stats" "=== Tap2TCP ===\nStreams: ${STREAMS:-0}/${MAX_STREAMS:-128}, Flows: ${FLOWS:-0}"
    fi

elif [ "$action" = "packet_storm" ]; then

    # Pre-test stats
    pre_err=0; pre_drop=0
    [ -d /sys/class/net/rvr_bridge/statistics ] && {
        pre_err=$(( $(cat /sys/class/net/rvr_bridge/statistics/rx_errors) + $(cat /sys/class/net/rvr_bridge/statistics/tx_errors) ))
        pre_drop=$(( $(cat /sys/class/net/rvr_bridge/statistics/rx_dropped) + $(cat /sys/class/net/rvr_bridge/statistics/tx_dropped) ))
    }

    send_phase "setup_storm" "=== Packet Storm (via bridge: $bridge_ip) ===\n128-byte UDP packets at 10 Mbps for 10 seconds"

    # UDP flood
    _ssh_remote "$ip" "killall iperf3 2>/dev/null; iperf3 -s -B $bridge_ip -D -1"
    sleep 1
    output=$(iperf3 -c "$bridge_ip" -t 10 -u -b 10M -l 128 2>&1)
    send_phase "flood" "$output"

    _ssh_remote "$ip" "killall iperf3 2>/dev/null"

    # Post-test error check
    result="=== Error Check ==="
    [ -d /sys/class/net/rvr_bridge/statistics ] && {
        post_err=$(( $(cat /sys/class/net/rvr_bridge/statistics/rx_errors) + $(cat /sys/class/net/rvr_bridge/statistics/tx_errors) ))
        post_drop=$(( $(cat /sys/class/net/rvr_bridge/statistics/rx_dropped) + $(cat /sys/class/net/rvr_bridge/statistics/tx_dropped) ))
        result="$result\nNew errors: $((post_err - pre_err))\nNew drops: $((post_drop - pre_drop))"
    }

    # Tap2TCP stats
    if [ -f /tmp/tap2tcp.stats ]; then
        . /tmp/tap2tcp.stats
        result="$result\nTap2TCP: ${STREAMS:-0} streams, ${FLOWS:-0} flows"
    fi
    send_phase "stats" "$result"

fi

send_done
