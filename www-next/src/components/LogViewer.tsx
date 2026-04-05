import { useState, useRef, useEffect, useCallback } from 'react';
import { Pause, Play, Trash2, Maximize2, Minimize2, Copy, Check, Search } from 'lucide-react';
import { useLogStream } from '../hooks/useLogStream';
import { cn } from '../lib/utils';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-blue-400',
  debug: 'text-slate-500',
};

const LEVEL_BG: Record<string, string> = {
  error: 'bg-red-500/5',
  warn: 'bg-amber-500/5',
};

export function LogViewer() {
  const { logs, connected, paused, clear, togglePause } = useLogStream();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(
    new Set(['error', 'warn', 'info', 'debug']),
  );
  const [showSearch, setShowSearch] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleLevel = (level: LogLevel) => {
    setLevelFilter(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  };

  const filteredLogs = logs.filter(log => {
    if (!levelFilter.has(log.level as LogLevel)) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (!paused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs.length, paused]);

  const handleCopy = useCallback(() => {
    const text = filteredLogs
      .map(l => `${l.timestamp} [${l.level}] [${l.source}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [filteredLogs]);

  return (
    <div className={cn(
      'bg-bg-card border border-border rounded-xl overflow-hidden transition-all',
      expanded && 'fixed inset-4 z-100 flex flex-col',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={cn(
            'w-2 h-2 rounded-full',
            connected ? 'bg-success animate-[pulse-dot_2s_infinite]' : 'bg-error',
          )} />
          <h3 className="font-semibold text-sm">Live Logs</h3>
          <span className="text-xs text-text-secondary">({filteredLogs.length})</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Level filters */}
          {(['error', 'warn', 'info', 'debug'] as const).map(level => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={cn(
                'text-xs px-2 py-0.5 rounded transition-colors',
                levelFilter.has(level)
                  ? (LEVEL_COLORS[level] || 'text-text-primary') + ' bg-white/5'
                  : 'text-text-secondary/30',
              )}
            >
              {level}
            </button>
          ))}

          <span className="w-px h-4 bg-border mx-1" />

          <button onClick={() => setShowSearch(s => !s)} className="p-1 text-text-secondary hover:text-text-primary" title="Search">
            <Search className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleCopy} className={cn('p-1 transition-colors', copied ? 'text-success' : 'text-text-secondary hover:text-text-primary')} title="Copy">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button onClick={togglePause} className="p-1 text-text-secondary hover:text-text-primary" title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button onClick={clear} className="p-1 text-text-secondary hover:text-text-primary" title="Clear">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-text-secondary hover:text-text-primary" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="px-4 py-2 border-b border-border">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter logs..."
            autoFocus
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono"
          />
        </div>
      )}

      {/* Log entries */}
      <div
        ref={containerRef}
        className={cn('overflow-y-auto font-mono text-xs', expanded ? 'flex-1' : 'h-96')}
        style={{ backgroundColor: '#0d1117' }}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary/50 text-sm">
            {logs.length === 0 ? 'Waiting for logs...' : 'No logs match filter'}
          </div>
        ) : (
          filteredLogs.map((log, i) => {
            const ts = log.timestamp.split('T')[1]?.split('.')[0] || log.timestamp.slice(11, 19);
            return (
              <div
                key={i}
                className={cn(
                  'flex gap-2 px-3 py-0.5 hover:bg-white/[0.03] leading-relaxed',
                  LEVEL_BG[log.level],
                )}
              >
                <span className="text-slate-600 flex-shrink-0 select-none">{ts}</span>
                <span className={cn('flex-shrink-0 select-none', LEVEL_COLORS[log.level] || 'text-text-primary')}>
                  [{log.source}]
                </span>
                <span className="text-slate-300 break-all">{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
