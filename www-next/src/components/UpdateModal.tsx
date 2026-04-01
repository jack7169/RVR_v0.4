import { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import type { StatusResponse } from '../api/types';
import { updateLocal, updateRemote, listBranches } from '../api/client';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  status: StatusResponse;
}

type Phase = 'select' | 'running' | 'done';

export function UpdateModal({ open, onClose, status }: Props) {
  const [updateGcs, setUpdateGcs] = useState(true);
  const [updateAircraft, setUpdateAircraft] = useState(false);
  const [phase, setPhase] = useState<Phase>('select');
  const [log, setLog] = useState('');
  const [success, setSuccess] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const aircraftIp = status.aircraft.tailscale_ip;
  const aircraftName = status.aircraft.profile_name;
  const hasAircraft = !!aircraftIp && status.aircraft.reachable;
  const currentBranch = status.version.branch || 'main';

  useEffect(() => {
    if (open) {
      setPhase('select');
      setLog('');
      setSuccess(false);
      setUpdateGcs(true);
      setUpdateAircraft(false);
      setSelectedBranch(currentBranch);
      // Fetch available branches
      setLoadingBranches(true);
      listBranches()
        .then(data => {
          setBranches(data.branches);
          setSelectedBranch(data.current);
        })
        .catch(() => setBranches([currentBranch]))
        .finally(() => setLoadingBranches(false));
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, currentBranch]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/cgi-bin/api.cgi?action=setup_log');
        if (!res.ok) return;
        const data = await res.json() as { log?: string };
        if (data.log) setLog(data.log);
        if (data.log?.includes('[UPDATE COMPLETE]')) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('done');
          setSuccess(data.log.includes('exit_code=0'));
        }
      } catch {}
    }, 2000);
  };

  const startUpdate = async () => {
    setPhase('running');
    setLog('Starting update...\n');

    // Pass branch if different from current
    const branchArg = selectedBranch !== currentBranch ? selectedBranch : undefined;

    try {
      if (updateGcs && updateAircraft && aircraftIp) {
        await updateRemote(aircraftIp, branchArg);
        startPolling();
      } else if (updateAircraft && aircraftIp) {
        await updateRemote(aircraftIp, branchArg);
        startPolling();
      } else if (updateGcs) {
        await updateLocal(branchArg);
        startPolling();
      }
    } catch (e) {
      setLog(prev => prev + `\nError: ${e instanceof Error ? e.message : 'Unknown error'}\n`);
      setPhase('done');
      setSuccess(false);
    }
  };

  const { version } = status;
  const isBranchSwitch = selectedBranch !== currentBranch;

  return (
    <Modal open={open} onClose={phase === 'running' ? () => {} : onClose} title="Update RVR" wide>
      {phase === 'select' && (
        <div className="space-y-4">
          <div className="text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-text-secondary">Current:</span>
              <code className="text-xs bg-bg-secondary px-2 py-0.5 rounded">{currentBranch}:{version.current}</code>
            </div>
            {version.update_available && (
              <div className="flex items-center gap-2">
                <span className="text-text-secondary">Latest:</span>
                <code className="text-xs bg-bg-secondary px-2 py-0.5 rounded">{version.latest}</code>
              </div>
            )}
          </div>

          {/* Branch selector */}
          <div className="border border-border rounded-lg p-3">
            <label className="text-sm font-medium block mb-1.5">Branch</label>
            {loadingBranches ? (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading branches...
              </div>
            ) : (
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="w-full bg-bg-secondary border border-border rounded-md px-3 py-1.5 text-sm"
              >
                {branches.map(b => (
                  <option key={b} value={b}>
                    {b}{b === currentBranch ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            )}
            {isBranchSwitch && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {selectedBranch === 'main'
                  ? 'Switching back to stable release branch.'
                  : 'Switching to a dev branch. Use main for stable releases.'}
              </div>
            )}
          </div>

          {/* Device selection */}
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium mb-2">Devices to update:</div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={updateGcs}
                onChange={e => setUpdateGcs(e.target.checked)}
                className="accent-accent"
              />
              This device (GCS)
            </label>
            {hasAircraft && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={updateAircraft}
                  onChange={e => setUpdateAircraft(e.target.checked)}
                  className="accent-accent"
                />
                Aircraft ({aircraftName || aircraftIp})
              </label>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              variant={isBranchSwitch ? 'warning' : 'primary'}
              size="sm"
              disabled={!updateGcs && !updateAircraft}
              onClick={startUpdate}
            >
              <Download className="w-3.5 h-3.5" />
              {isBranchSwitch ? `Switch to ${selectedBranch}` : 'Start Update'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-accent">
            <Loader2 className="w-4 h-4 animate-spin" />
            {isBranchSwitch ? `Switching to ${selectedBranch}...` : 'Updating...'}
          </div>
          <pre className="bg-bg-secondary rounded-lg p-3 text-xs max-h-64 overflow-y-auto font-mono whitespace-pre-wrap">
            {log}
            <div ref={logEndRef} />
          </pre>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 text-sm ${success ? 'text-success' : 'text-error'}`}>
            {success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {success ? 'Update complete!' : 'Update failed'}
          </div>
          <pre className="bg-bg-secondary rounded-lg p-3 text-xs max-h-64 overflow-y-auto font-mono whitespace-pre-wrap">
            {log}
          </pre>
          {success && (
            <div className="text-xs text-text-secondary">
              Reload the page to use the updated web UI.
            </div>
          )}
          <div className="flex justify-end gap-2">
            {success && (
              <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
