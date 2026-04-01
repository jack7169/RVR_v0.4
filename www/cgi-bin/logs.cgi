#!/bin/sh
#
# RVR Web UI - Log Streaming API (Server-Sent Events)
# Streams RVR-related logs in real-time
#

# SSE headers
echo "Content-Type: text/event-stream"
echo "Cache-Control: no-cache"
echo "Connection: keep-alive"
echo "X-Accel-Buffering: no"
echo ""

# Log files to monitor
SETUP_LOG="/tmp/rvr-setup.log"
WATCHDOG_LOG="/tmp/rvr-watchdog.log"

# Helper: escape string for JSON
json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/\r//g'
}

# Helper: send SSE event
send_event() {
    local event_type="$1"
    local data="$2"
    echo "event: $event_type"
    echo "data: $data"
    echo ""
}

# Helper: send log line as SSE
send_log() {
    local message="$1"
    local source="$2"
    local timestamp=$(date '+%Y-%m-%dT%H:%M:%S')
    local escaped_msg=$(json_escape "$message")

    # Determine log level from message content
    local level="info"
    case "$message" in
        *ERROR*|*error*|*FAILED*|*failed*) level="error" ;;
        *WARN*|*warn*|*WARNING*) level="warn" ;;
        *DEBUG*|*debug*) level="debug" ;;
    esac

    echo "data: {\"timestamp\": \"$timestamp\", \"level\": \"$level\", \"source\": \"$source\", \"message\": \"$escaped_msg\"}"
    echo ""
}

# Send initial connection event
send_event "connected" "{\"message\": \"Log stream connected\", \"timestamp\": \"$(date '+%Y-%m-%dT%H:%M:%S')\"}"

# Send recent log history (last 50 lines)
send_event "history_start" "{\"message\": \"Sending recent log history\"}"

# Setup log history
if [ -f "$SETUP_LOG" ]; then
    tail -20 "$SETUP_LOG" 2>/dev/null | while IFS= read -r line; do
        [ -n "$line" ] && send_log "$line" "setup"
    done
fi

# Watchdog log history
if [ -f "$WATCHDOG_LOG" ]; then
    tail -10 "$WATCHDOG_LOG" 2>/dev/null | while IFS= read -r line; do
        [ -n "$line" ] && send_log "$line" "watchdog"
    done
fi

# System log history (filtered)
logread 2>/dev/null | grep -iE "rvr|tap2tcp|kcptun" | tail -20 | while IFS= read -r line; do
    [ -n "$line" ] && send_log "$line" "system"
done

send_event "history_end" "{\"message\": \"Log history complete\"}"

# Auto-kill after 5 minutes to prevent orphaned processes
# SSE clients should reconnect — this is a safety net
(sleep 300; kill -TERM $$ 2>/dev/null; sleep 2; kill -KILL $$ 2>/dev/null) &
TIMEOUT_PID=$!

# Cleanup function — kill ALL child processes
cleanup() {
    kill $TIMEOUT_PID 2>/dev/null
    # Kill all background jobs (tail, logread, grep, reader)
    for pid in $(jobs -p 2>/dev/null); do
        kill "$pid" 2>/dev/null
    done
    # Kill entire process group as failsafe
    kill 0 2>/dev/null
    rm -f "/tmp/rvr-logs-$$.fifo"
    exit 0
}

trap cleanup EXIT INT TERM HUP

# Create a FIFO for aggregating log sources
LOG_FIFO="/tmp/rvr-logs-$$.fifo"
mkfifo "$LOG_FIFO" 2>/dev/null || true

# Start background log tailers
(
    # Tail setup log if it exists
    if [ -f "$SETUP_LOG" ]; then
        tail -f "$SETUP_LOG" 2>/dev/null | while IFS= read -r line; do
            echo "setup|$line"
        done &
    fi

    # Tail watchdog log if it exists
    if [ -f "$WATCHDOG_LOG" ]; then
        tail -f "$WATCHDOG_LOG" 2>/dev/null | while IFS= read -r line; do
            echo "watchdog|$line"
        done &
    fi

    # Stream system logs (filtered for RVR-related entries)
    # Note: BusyBox grep doesn't support --line-buffered, but while read handles it
    logread -f 2>/dev/null | grep -iE "rvr|tap2tcp|kcptun" | while IFS= read -r line; do
        echo "system|$line"
    done &

    # Wait for all background jobs
    wait
) > "$LOG_FIFO" 2>/dev/null &

TAILER_PID=$!

# Read from FIFO and send as SSE
while IFS='|' read -r source line <&3; do
    [ -n "$line" ] && send_log "$line" "$source"
done 3< "$LOG_FIFO" &

READER_PID=$!

# Keep connection alive with heartbeat
while true; do
    # Check if client is still connected (write will fail if not)
    echo ": heartbeat" 2>/dev/null || break
    echo ""

    # Also check if our tailer processes are still running
    kill -0 $TAILER_PID 2>/dev/null || break

    sleep 15
done

# Cleanup
rm -f "$LOG_FIFO"
kill $TAILER_PID $READER_PID 2>/dev/null
