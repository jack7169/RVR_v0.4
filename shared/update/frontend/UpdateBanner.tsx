import { useState } from 'react';
import { ArrowUpCircle, X, RefreshCw } from 'lucide-react';
import { checkUpdate } from './api';
import type { CheckUpdateResponse } from './types';

interface Props {
  current: string;
  latest: string;
  branch: string;
  onUpdate: () => void;
  onDismiss: () => void;
  onCheckResult?: (result: CheckUpdateResponse) => void;
}

export function UpdateBanner({ current, latest, branch, onUpdate, onDismiss, onCheckResult }: Props) {
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const result = await checkUpdate();
      onCheckResult?.(result);
    } catch {} finally {
      setChecking(false);
    }
  };

  return (
    <div className="bg-warning/15 border-b border-warning/30 px-4 py-2">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <ArrowUpCircle className="w-4 h-4 text-warning shrink-0" />
          <span className="text-text-primary">
            Update available on <code className="text-xs">{branch}</code>: <code className="text-xs">{current}</code> &rarr; <code className="text-xs">{latest}</code>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            title="Re-check for updates"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onUpdate}
            className="px-3 py-1 text-xs font-medium rounded-md bg-warning text-black hover:bg-warning/80 transition-colors"
          >
            Update Now
          </button>
          <button
            onClick={onDismiss}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
