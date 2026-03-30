import { useRef, useEffect } from 'react';
import { useLogStream } from '../hooks/useLogStream';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';

const levelColors: Record<string, string> = {
  error: 'text-error',
  warn: 'text-warning',
  info: 'text-text-primary',
  debug: 'text-text-secondary',
};

export function LogViewer() {
  const { logs, connected, paused, clear, togglePause } = useLogStream();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, paused]);

  return (
    <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-success' : 'bg-error')} />
          <span className="text-sm font-semibold">Live Logs</span>
          <span className="text-xs text-text-secondary">({logs.length})</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" variant="ghost" onClick={clear}>Clear</Button>
        </div>
      </div>
      <div ref={containerRef} className="p-3 h-64 overflow-y-auto font-mono text-xs space-y-0.5 bg-[#0d1117]">
        {logs.length === 0 && <div className="text-text-secondary italic">Waiting for logs...</div>}
        {logs.map((log, i) => (
          <div key={i} className={cn(levelColors[log.level] || 'text-text-primary')}>
            <span className="text-text-secondary">{log.timestamp}</span>
            {' '}
            <span className="text-accent">[{log.source}]</span>
            {' '}
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}
