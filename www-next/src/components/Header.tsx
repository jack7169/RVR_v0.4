import { cn } from '../lib/utils';

export type AppTab = 'dashboard' | 'binding' | 'help';

interface HeaderProps {
  connected: boolean;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onProfileChange: () => void;
}

export function Header({ connected, activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="bg-bg-secondary border-b border-border sticky top-0 z-100">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-3 h-3 rounded-full animate-[pulse-dot_2s_infinite]',
              connected ? 'bg-success' : 'bg-error',
            )} />
            <h1 className="text-lg font-semibold">L2 Bridge</h1>
          </div>
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
