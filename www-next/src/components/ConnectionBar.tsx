import { useState, useEffect } from 'react';
import type { StatusResponse } from '../api/types';
import { formatDuration } from '../lib/utils';
import { cn } from '../lib/utils';

interface Props {
  status: StatusResponse;
  lastUpdate: Date | null;
}

export function ConnectionBar({ status, lastUpdate }: Props) {
  const { connection } = status;
  const [elapsed, setElapsed] = useState(connection.duration_seconds);

  useEffect(() => {
    setElapsed(connection.duration_seconds);
    if (!connection.established) return;
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connection.established, connection.duration_seconds]);

  return (
    <div className="flex items-center justify-between bg-bg-card rounded-xl border border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-2.5 h-2.5 rounded-full animate-[pulse-dot_2s_infinite]',
          connection.established ? 'bg-success' : 'bg-error',
        )} />
        <span className="font-medium text-sm">
          {connection.established ? 'Connected' : 'Disconnected'}
        </span>
        {connection.established && (
          <span className="text-text-secondary text-sm font-mono">{formatDuration(elapsed)}</span>
        )}
      </div>
      {lastUpdate && (
        <span className="text-text-secondary text-xs">
          Updated {lastUpdate.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
