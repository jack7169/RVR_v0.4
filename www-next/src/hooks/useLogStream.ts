import { useState, useEffect, useRef, useCallback } from 'react';
import type { LogEntry } from '../api/types';

const MAX_LOGS = 500;

export function useLogStream() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(paused);

  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource('/cgi-bin/logs.cgi');
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const entry: LogEntry = JSON.parse(event.data);
        setLogs(prev => {
          const next = [...prev, entry];
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
      } catch {
        // Non-JSON messages (heartbeats, etc.)
      }
    };

    es.addEventListener('connected', () => setConnected(true));

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const clear = useCallback(() => setLogs([]), []);
  const togglePause = useCallback(() => setPaused(p => !p), []);

  return { logs, connected, paused, clear, togglePause };
}
