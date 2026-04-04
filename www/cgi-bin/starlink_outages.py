#!/usr/bin/env python3
"""Query Starlink dish for outage history and output JSON.

Called by api.cgi. Expects starlink_grpc on PYTHONPATH
(set by api.cgi from starlink-grpc-tools).

Reads structured outage events directly from the dish's history.outages
array — the same data source the Starlink app uses. Each event has a
cause enum, nanosecond-precision duration, and GPS-epoch timestamp.
"""

import json
import signal
import sys
import time

DISH_ADDRESS = "192.168.100.1:9200"
TIMEOUT = 5  # seconds for gRPC call
GPS_EPOCH_OFFSET = 315964800  # seconds between GPS epoch and Unix epoch

CAUSE_NAMES = {
    0: "UNKNOWN",
    1: "BOOTING",
    2: "STOWED",
    3: "THERMAL_SHUTDOWN",
    4: "NO_SCHEDULE",
    5: "NO_SATS",
    6: "OBSTRUCTED",
    7: "NO_DOWNLINK",
    8: "NO_PINGS",
    9: "ACTUATOR_ACTIVITY",
    10: "CABLE_TEST",
    11: "SLEEPING",
    13: "SKY_SEARCH",
    14: "INHIBIT_RF",
}


class _GrpcTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise _GrpcTimeout()


try:
    import starlink_grpc
except ImportError:
    json.dump({"available": False, "error": "starlink_grpc not available"}, sys.stdout)
    sys.exit(0)


def get_outages(window_seconds=3600):
    """Fetch dish outage history and current state."""
    # gRPC call with hard timeout (reflection can hang indefinitely)
    try:
        signal.signal(signal.SIGALRM, _alarm_handler)
        signal.alarm(TIMEOUT)
        ctx = starlink_grpc.ChannelContext(target=DISH_ADDRESS)
        history = starlink_grpc.get_history(context=ctx)
        signal.alarm(0)
    except _GrpcTimeout:
        return {"available": False, "error": "Dish unreachable (timeout)"}
    except Exception as e:
        signal.alarm(0)
        return {"available": False, "error": "Dish unreachable: %s" % e}

    now = time.time()
    cutoff = now - window_seconds

    # Read structured outage events from dish
    events = []
    total_down_s = 0.0
    try:
        for o in history.outages:
            start_unix = o.start_timestamp_ns / 1e9 + GPS_EPOCH_OFFSET
            duration_s = o.duration_ns / 1e9
            end_unix = start_unix + duration_s

            # Skip events outside requested window
            if end_unix < cutoff:
                continue

            cause_int = int(o.cause)
            events.append({
                "type": "drop",
                "cause": CAUSE_NAMES.get(cause_int, "UNKNOWN"),
                "start": round(start_unix, 1),
                "end": round(end_unix, 1),
                "duration_seconds": round(duration_s, 2),
                "did_switch": bool(o.did_switch),
            })
            # Only count time within the window for uptime calc
            effective_start = max(start_unix, cutoff)
            effective_end = min(end_unix, now)
            if effective_end > effective_start:
                total_down_s += effective_end - effective_start
    except (AttributeError, TypeError):
        pass  # No outages field — dish may be too old

    # Sort by start time
    events.sort(key=lambda e: e["start"])

    # Compute uptime
    uptime_pct = ((window_seconds - total_down_s) / window_seconds * 100) if window_seconds else 100
    uptime_pct = max(0.0, min(100.0, uptime_pct))

    # Average latency from ring buffer (last 900 samples)
    avg_latency = _avg_latency(history)

    # Current state from latest sample
    current = _current_state(history)

    return {
        "available": True,
        "outages": events,
        "summary": {
            "total_drops": len(events),
            "total_recoveries": len(events),  # each drop has an implicit recovery
            "uptime_pct": round(uptime_pct, 2),
            "avg_latency_ms": avg_latency,
            "total_seconds_down": round(total_down_s, 1),
        },
        "current": current,
    }


def _avg_latency(history):
    """Compute average latency from the ring buffer samples."""
    try:
        total = 0.0
        count = 0
        for lat in history.pop_ping_latency_ms:
            if lat and lat > 0:
                total += lat
                count += 1
        return round(total / count, 1) if count else 0
    except (AttributeError, TypeError):
        return 0


def _current_state(history):
    """Get current dish state from latest sample."""
    try:
        current = int(history.current)
        samples = len(history.pop_ping_drop_rate)
        latest_idx = (current - 1) % samples
        drop = history.pop_ping_drop_rate[latest_idx]
        latency = 0
        try:
            latency = history.pop_ping_latency_ms[latest_idx]
        except (AttributeError, IndexError, TypeError):
            pass
        return {
            "connected": drop < 0.5,
            "latency_ms": round(latency, 1) if latency else 0,
        }
    except (AttributeError, TypeError, IndexError):
        return {"connected": False, "latency_ms": 0}


if __name__ == "__main__":
    window = 3600
    if len(sys.argv) > 1:
        try:
            window = int(sys.argv[1])
        except ValueError:
            pass
    try:
        result = get_outages(window)
    except Exception as e:
        result = {"available": False, "error": "Unexpected error: %s" % e}
    json.dump(result, sys.stdout)
