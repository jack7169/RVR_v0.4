import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { checkUpdate } from '../api/client';

export type AppTab = 'dashboard' | 'binding' | 'help';

interface VersionInfo {
  current: string;
  latest: string;
  branch: string;
  update_available: boolean;
}

interface HeaderProps {
  connected: boolean;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  version?: VersionInfo;
}

export function Header({ connected, activeTab, onTabChange, version }: HeaderProps) {
  const [checking, setChecking] = useState(false);
  const versionHash = version?.current && version.current !== 'unknown' ? version.current : null;
  const branch = version?.branch || 'main';
  const isDevBranch = branch !== 'main';
  const repoUrl = 'https://github.com/jack7169/RVR_v0.4';

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      await checkUpdate();
      // Status poll (3s interval) picks up the result —
      // forcing an immediate invalidation causes a render storm
      // that crashes Recharts' internal redux subscriptions.
    } catch {} finally {
      setChecking(false);
    }
  };

  return (
    <header className="bg-bg-secondary border-b border-border sticky top-0 z-100">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-3 h-3 rounded-full animate-[pulse-dot_2s_infinite]',
              connected ? 'bg-success' : 'bg-error',
            )} />
            <h1 className="text-lg font-semibold">Robust Virtual Radio</h1>
          </div>
          {versionHash && (
            <div className="flex items-center gap-1.5">
              <a
                href={`${repoUrl}/commit/${versionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  version?.update_available ? 'bg-warning' : isDevBranch ? 'bg-accent' : 'bg-success',
                )} />
                <span className={isDevBranch ? 'text-accent' : undefined}>{branch}</span>:{versionHash}
              </a>
              <button
                onClick={handleCheckUpdate}
                disabled={checking}
                className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                title="Check for updates"
              >
                <RefreshCw className={cn('w-3 h-3', checking && 'animate-spin')} />
              </button>
            </div>
          )}
        </div>

        <nav className="flex gap-1 -mb-px">
          {(['dashboard', 'binding', 'help'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border',
              )}
            >
              {tab === 'dashboard' ? 'Dashboard' : tab === 'binding' ? 'Binding' : 'Help'}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
