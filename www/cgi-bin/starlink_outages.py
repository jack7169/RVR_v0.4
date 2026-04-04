#!/usr/bin/env python3
"""Query Starlink dish for outage/drop history and output JSON.

Called by api.cgi. Expects starlink_grpc on PYTHONPATH
(set by api.cgi from /opt/starnav/starlink-grpc-tools or bundled copy).

Outputs JSON compatible with the RVR OutagePanel format.
"""

import json
import os
import signal
import sys
import time

DISH_ADDRESS = "192.168.100.1:9200"
TIMEOUT = 5  # seconds for gRPC call
HISTORY_FILE = "/tmp/starlink-history.json"
CURRENT_FILE = "/tmp/starlink-current.json"


class _GrpcTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise _GrpcTimeout("gRPC call timed out")


try:
    import starlink_grpc
except ImportError:
    json.dump({"available": False, "error": "starlink_grpc not available"}, sys.stdout)
    sys.exit(0)


def get_outages(window_seconds=3600):
    """Fetch dish history and convert drop samples into outage events."""
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
        return {"available": False, "error": f"Dish unreachable: {e}"}

    try:
        current_counter = int(history.current)
        samples = len(history.pop_ping_drop_rate)
    except (AttributeError, TypeError):
        return {"available": False, "error": "No history data"}

    # Limit to valid samples and requested window
    valid_samples = min(samples, current_counter)
    parse_samples = min(valid_samples, window_seconds)

    if parse_samples == 0:
        return {"available": True, "outages": [], "summary": _empty_summary(), "current": _current_state(history)}

    # Ring buffer navigation
    end_offset = current_counter % samples
    start_offset = (current_counter - parse_samples) % samples

    now = time.time()
    events = []
    in_drop = False
    drop_start_idx = 0
    drop_rate_sum = 0.0
    drop_samples = 0
    total_drop_seconds = 0
    total_drop_events = 0
    total_recovery_events = 0
    latency_sum = 0.0
    latency_count = 0

    for offset in range(parse_samples):
        idx = (current_counter - parse_samples + offset) % samples
        drop_rate = history.pop_ping_drop_rate[idx]

        # Collect latency for non-drop samples
        if drop_rate < 1.0:
            try:
                lat = history.pop_ping_latency_ms[idx]
                if lat and lat > 0:
                    latency_sum += lat
                    latency_count += 1
            except (AttributeError, IndexError, TypeError):
                pass

        is_drop = drop_rate >= 0.02  # >2% packet loss = drop

        if is_drop and not in_drop:
            # Drop starts
            in_drop = True
            drop_start_idx = offset
            drop_rate_sum = drop_rate
            drop_samples = 1
        elif is_drop and in_drop:
            # Drop continues
            drop_rate_sum += drop_rate
            drop_samples += 1
        elif not is_drop and in_drop:
            # Drop ends — emit event
            duration = offset - drop_start_idx
            event_time = now - (parse_samples - drop_start_idx)
            events.append({
                "type": "drop",
                "cause": _guess_cause(history, drop_start_idx, offset, current_counter, samples),
                "start": int(event_time),
                "end": int(event_time + duration),
                "duration_seconds": duration,
                "drop_rate": round(drop_rate_sum / drop_samples, 3) if drop_samples else 0,
            })
            total_drop_seconds += duration
            total_drop_events += 1

            # Emit recovery event
            events.append({
                "type": "recovery",
                "cause": "",
                "start": int(event_time + duration),
                "end": int(event_time + duration),
                "duration_seconds": 0,
                "drop_rate": 0,
            })
            total_recovery_events += 1
            in_drop = False

    # Handle ongoing drop at end of window
    if in_drop:
        duration = parse_samples - drop_start_idx
        event_time = now - (parse_samples - drop_start_idx)
        events.append({
            "type": "drop",
            "cause": _guess_cause(history, drop_start_idx, parse_samples, current_counter, samples),
            "start": int(event_time),
            "end": int(now),
            "duration_seconds": duration,
            "drop_rate": round(drop_rate_sum / drop_samples, 3) if drop_samples else 0,
        })
        total_drop_seconds += duration
        total_drop_events += 1

    uptime_pct = ((parse_samples - total_drop_seconds) / parse_samples * 100) if parse_samples else 100
    avg_latency = round(latency_sum / latency_count, 1) if latency_count else 0

    return {
        "available": True,
        "outages": events,
        "summary": {
            "total_drops": total_drop_events,
            "total_recoveries": total_recovery_events,
            "uptime_pct": round(uptime_pct, 2),
            "avg_latency_ms": avg_latency,
            "total_seconds_down": total_drop_seconds,
        },
        "current": _current_state(history),
    }


def _guess_cause(history, start_idx, end_idx, current_counter, samples):
    """Try to determine the cause of a drop from available fields."""
    # Check if obstruction data is available
    try:
        for offset in range(start_idx, min(end_idx, start_idx + 5)):
            idx = (current_counter - (end_idx - offset)) % samples
            if hasattr(history, "obstructed") and history.obstructed[idx]:
                return "OBSTRUCTED"
    except (IndexError, TypeError, AttributeError):
        pass
    return "NO_SIGNAL"


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


def _empty_summary():
    return {
        "total_drops": 0,
        "total_recoveries": 0,
        "uptime_pct": 100,
        "avg_latency_ms": 0,
        "total_seconds_down": 0,
    }


def get_accumulated(window_seconds=3600):
    """Read accumulated history from collector + live current state."""
    now = time.time()
    cutoff = now - window_seconds

    # Read accumulated events
    events = []
    if os.path.exists(HISTORY_FILE):
        try:
            all_events = json.load(open(HISTORY_FILE))
            events = [e for e in all_events if e.get("end", 0) > cutoff]
        except (json.JSONDecodeError, IOError):
            pass

    # Read current state
    current = {"connected": False, "latency_ms": 0}
    avg_latency = 0
    if os.path.exists(CURRENT_FILE):
        try:
            cur = json.load(open(CURRENT_FILE))
            current = {"connected": cur.get("connected", False), "latency_ms": cur.get("latency_ms", 0)}
            avg_latency = cur.get("avg_latency_ms", 0)
        except (json.JSONDecodeError, IOError):
            pass

    drop_events = [e for e in events if e["type"] == "drop"]
    recovery_events = [e for e in events if e["type"] == "recovery"]
    total_drop_seconds = sum(e.get("duration_seconds", 0) for e in drop_events)
    uptime_pct = ((window_seconds - total_drop_seconds) / window_seconds * 100) if window_seconds else 100
    uptime_pct = max(0, min(100, uptime_pct))

    return {
        "available": True,
        "outages": events,
        "summary": {
            "total_drops": len(drop_events),
            "total_recoveries": len(recovery_events),
            "uptime_pct": round(uptime_pct, 2),
            "avg_latency_ms": avg_latency,
            "total_seconds_down": total_drop_seconds,
        },
        "current": current,
    }


if __name__ == "__main__":
    window = 3600
    if len(sys.argv) > 1:
        try:
            window = int(sys.argv[1])
        except ValueError:
            pass
    try:
        # Use accumulated history if collector is running, otherwise fall back to live query
        if os.path.exists(HISTORY_FILE) and os.path.exists(CURRENT_FILE):
            # Check collector freshness (should update every 60s)
            current_age = time.time() - os.path.getmtime(CURRENT_FILE)
            if current_age < 120:
                result = get_accumulated(window)
            else:
                result = get_outages(window)
        else:
            result = get_outages(window)
    except Exception as e:
        result = {"available": False, "error": f"Unexpected error: {e}"}
    json.dump(result, sys.stdout)
