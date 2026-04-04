#!/usr/bin/env python3
"""Starlink history collector — called by watchdog every 60s.

Polls the dish for new samples since last run, detects drop events,
and appends them to /tmp/starlink-history.json. Maintains a cursor
file to track which samples have been processed.

The accumulated history is read by starlink_outages.py to serve
time windows beyond the dish's 900s ring buffer.
"""

import json
import os
import signal
import sys
import time

DISH_ADDRESS = "192.168.100.1:9200"
TIMEOUT = 5
HISTORY_FILE = "/tmp/starlink-history.json"
CURSOR_FILE = "/tmp/starlink-cursor"
MAX_HISTORY_AGE = 86400 + 3600  # 25 hours — covers 24h window with margin
DROP_THRESHOLD = 0.02  # 2% packet loss


class _GrpcTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise _GrpcTimeout()


def collect():
    try:
        import starlink_grpc
    except ImportError:
        return

    # Fetch history with timeout
    try:
        signal.signal(signal.SIGALRM, _alarm_handler)
        signal.alarm(TIMEOUT)
        ctx = starlink_grpc.ChannelContext(target=DISH_ADDRESS)
        history = starlink_grpc.get_history(context=ctx)
        signal.alarm(0)
    except (_GrpcTimeout, Exception):
        signal.alarm(0)
        return

    try:
        current_counter = int(history.current)
        samples = len(history.pop_ping_drop_rate)
    except (AttributeError, TypeError):
        return

    # Read cursor — last processed counter value
    last_counter = 0
    if os.path.exists(CURSOR_FILE):
        try:
            last_counter = int(open(CURSOR_FILE).read().strip())
        except (ValueError, IOError):
            pass

    # How many new samples since last run
    new_samples = current_counter - last_counter
    if new_samples <= 0:
        return
    # Cap to buffer size (can't read more than what's in the ring buffer)
    new_samples = min(new_samples, samples)

    now = time.time()
    events = []
    in_drop = False
    drop_start_offset = 0
    drop_rate_sum = 0.0
    drop_count = 0
    latency_sum = 0.0
    latency_count = 0

    for offset in range(new_samples):
        idx = (current_counter - new_samples + offset) % samples
        drop_rate = history.pop_ping_drop_rate[idx]

        if drop_rate < 1.0:
            try:
                lat = history.pop_ping_latency_ms[idx]
                if lat and lat > 0:
                    latency_sum += lat
                    latency_count += 1
            except (AttributeError, IndexError, TypeError):
                pass

        is_drop = drop_rate >= DROP_THRESHOLD

        if is_drop and not in_drop:
            in_drop = True
            drop_start_offset = offset
            drop_rate_sum = drop_rate
            drop_count = 1
        elif is_drop and in_drop:
            drop_rate_sum += drop_rate
            drop_count += 1
        elif not is_drop and in_drop:
            duration = offset - drop_start_offset
            event_time = now - (new_samples - drop_start_offset)
            events.append({
                "type": "drop",
                "cause": _guess_cause(history, drop_start_offset, offset, current_counter, samples),
                "start": int(event_time),
                "end": int(event_time + duration),
                "duration_seconds": duration,
                "drop_rate": round(drop_rate_sum / drop_count, 3) if drop_count else 0,
            })
            events.append({
                "type": "recovery",
                "cause": "",
                "start": int(event_time + duration),
                "end": int(event_time + duration),
                "duration_seconds": 0,
                "drop_rate": 0,
            })
            in_drop = False

    # Handle ongoing drop at end
    if in_drop:
        duration = new_samples - drop_start_offset
        event_time = now - (new_samples - drop_start_offset)
        events.append({
            "type": "drop",
            "cause": _guess_cause(history, drop_start_offset, new_samples, current_counter, samples),
            "start": int(event_time),
            "end": int(now),
            "duration_seconds": duration,
            "drop_rate": round(drop_rate_sum / drop_count, 3) if drop_count else 0,
        })

    # Compute summary for this interval
    avg_latency = round(latency_sum / latency_count, 1) if latency_count else 0

    # Load existing history
    existing = []
    if os.path.exists(HISTORY_FILE):
        try:
            existing = json.load(open(HISTORY_FILE))
        except (json.JSONDecodeError, IOError):
            existing = []

    # Append new events
    existing.extend(events)

    # Prune old events (older than MAX_HISTORY_AGE)
    cutoff = now - MAX_HISTORY_AGE
    existing = [e for e in existing if e.get("end", 0) > cutoff]

    # Write atomically
    tmp = HISTORY_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(existing, f)
    os.rename(tmp, HISTORY_FILE)

    # Update cursor and save current latency for live reads
    with open(CURSOR_FILE, "w") as f:
        f.write(str(current_counter))

    # Save latest stats for quick access
    stats = {
        "timestamp": int(now),
        "avg_latency_ms": avg_latency,
        "connected": history.pop_ping_drop_rate[(current_counter - 1) % samples] < 0.5,
        "latency_ms": 0,
    }
    try:
        stats["latency_ms"] = round(history.pop_ping_latency_ms[(current_counter - 1) % samples], 1)
    except (AttributeError, IndexError, TypeError):
        pass
    with open("/tmp/starlink-current.json", "w") as f:
        json.dump(stats, f)


def _guess_cause(history, start_idx, end_idx, current_counter, samples):
    try:
        for offset in range(start_idx, min(end_idx, start_idx + 5)):
            idx = (current_counter - (end_idx - offset)) % samples
            if hasattr(history, "obstructed") and history.obstructed[idx]:
                return "OBSTRUCTED"
    except (IndexError, TypeError, AttributeError):
        pass
    return "NO_SIGNAL"


if __name__ == "__main__":
    collect()
