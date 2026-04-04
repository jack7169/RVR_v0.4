#!/usr/bin/env python3
"""Query Starlink dish for outage history and output JSON.

Called by api.cgi. Expects starlink_grpc on PYTHONPATH.

Reads structured outage events directly from the dish's history.outages
array — the same data source the Starlink app uses. Results are cached
to /tmp for 30s to avoid repeated gRPC calls on every poll/window switch.
"""

import json
import os
import signal
import sys
import time

DISH_ADDRESS = "192.168.100.1:9200"
TIMEOUT = 5
GPS_EPOCH_OFFSET = 315964800
CACHE_FILE = "/tmp/starlink-outages-cache.json"
CACHE_TTL = 30  # seconds

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


def _fetch_from_dish():
    """Fetch all outages + current state from dish via gRPC. Returns cache dict or error dict."""
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

    # Convert all outage events
    outages = []
    try:
        for o in history.outages:
            start_unix = o.start_timestamp_ns / 1e9 + GPS_EPOCH_OFFSET
            duration_s = o.duration_ns / 1e9
            outages.append({
                "type": "drop",
                "cause": CAUSE_NAMES.get(int(o.cause), "UNKNOWN"),
                "start": round(start_unix, 1),
                "end": round(start_unix + duration_s, 1),
                "duration_seconds": round(duration_s, 2),
                "did_switch": bool(o.did_switch),
            })
    except (AttributeError, TypeError):
        pass

    outages.sort(key=lambda e: e["start"])

    # Average latency from ring buffer
    avg_latency = 0
    try:
        total = 0.0
        count = 0
        for lat in history.pop_ping_latency_ms:
            if lat and lat > 0:
                total += lat
                count += 1
        if count:
            avg_latency = round(total / count, 1)
    except (AttributeError, TypeError):
        pass

    # Current state
    current = {"connected": False, "latency_ms": 0}
    try:
        cur = int(history.current)
        samples = len(history.pop_ping_drop_rate)
        idx = (cur - 1) % samples
        drop = history.pop_ping_drop_rate[idx]
        lat = 0
        try:
            lat = history.pop_ping_latency_ms[idx]
        except (AttributeError, IndexError, TypeError):
            pass
        current = {"connected": drop < 0.5, "latency_ms": round(lat, 1) if lat else 0}
    except (AttributeError, TypeError, IndexError):
        pass

    return {
        "available": True,
        "timestamp": now,
        "outages": outages,
        "avg_latency_ms": avg_latency,
        "current": current,
    }


def _get_cached():
    """Return cached dish data if fresh, otherwise fetch and cache."""
    if os.path.exists(CACHE_FILE):
        try:
            age = time.time() - os.path.getmtime(CACHE_FILE)
            if age < CACHE_TTL:
                with open(CACHE_FILE) as f:
                    data = json.load(f)
                if data.get("available"):
                    return data
        except (json.JSONDecodeError, IOError, OSError):
            pass

    data = _fetch_from_dish()
    if data.get("available"):
        try:
            tmp = CACHE_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(data, f)
            os.rename(tmp, CACHE_FILE)
        except IOError:
            pass
    return data


def _filter_window(data, window_seconds):
    """Filter cached data to a specific time window and compute summary."""
    if not data.get("available"):
        return data

    now = time.time()
    cutoff = now - window_seconds

    events = [o for o in data["outages"] if o["end"] > cutoff]

    total_down_s = 0.0
    for o in events:
        effective_start = max(o["start"], cutoff)
        effective_end = min(o["end"], now)
        if effective_end > effective_start:
            total_down_s += effective_end - effective_start

    uptime_pct = ((window_seconds - total_down_s) / window_seconds * 100) if window_seconds else 100
    uptime_pct = max(0.0, min(100.0, uptime_pct))

    return {
        "available": True,
        "outages": events,
        "summary": {
            "total_drops": len(events),
            "total_recoveries": len(events),
            "uptime_pct": round(uptime_pct, 2),
            "avg_latency_ms": data.get("avg_latency_ms", 0),
            "total_seconds_down": round(total_down_s, 1),
        },
        "current": data.get("current", {"connected": False, "latency_ms": 0}),
    }


if __name__ == "__main__":
    window = 3600
    if len(sys.argv) > 1:
        try:
            window = int(sys.argv[1])
        except ValueError:
            pass
    try:
        data = _get_cached()
        result = _filter_window(data, window)
    except Exception as e:
        result = {"available": False, "error": "Unexpected error: %s" % e}
    json.dump(result, sys.stdout)
