import { useEffect, useState } from 'react';
import { listAircraft, setActiveAircraft } from '../api/client';
import type { AircraftProfiles } from '../api/types';
import { cn } from '../lib/utils';
import { useToast } from './ui/Toast';

export type AppTab = 'dashboard' | 'binding' | 'help';

interface HeaderProps {
  connected: boolean;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onProfileChange: () => void;
}

export function Header({ connected, activeTab, onTabChange, onProfileChange }: HeaderProps) {
  const [profiles, setProfiles] = useState<AircraftProfiles | null>(null);
  const { toast } = useToast();

  const loadProfiles = async () => {
    try {
      const data = await listAircraft();
      setProfiles(data);
    } catch {
      // Profiles may not exist yet
    }
  };

  useEffect(() => { loadProfiles(); }, []);

  const handleSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;
    try {
      await setActiveAircraft(id);
      await loadProfiles();
      onProfileChange();
      toast('Aircraft switched', 'success');
    } catch {
      toast('Failed to switch aircraft', 'error');
    }
  };

  return (
    <header className="bg-bg-secondary border-b border-border sticky top-0 z-100">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between gap-4 py-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-3 h-3 rounded-full animate-[pulse-dot_2s_infinite]',
              connected ? 'bg-success' : 'bg-error',
            )} />
            <h1 className="text-lg font-semibold">L2 Bridge</h1>
          </div>

          {activeTab === 'dashboard' && (
            <div className="flex items-center gap-2">
              <label className="text-text-secondary text-sm">Aircraft:</label>
              <select
                value={profiles?.active || ''}
                onChange={handleSelect}
                className="bg-bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="">-- Select --</option>
                {profiles && Object.entries(profiles.profiles).map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
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
