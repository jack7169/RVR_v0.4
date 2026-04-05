import { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { updateDevices, listBranches } from './api';
import { updateConfig, fetchUpdateDevices } from '@app/updateConfig';
import { Modal } from '@app/components/ui/Modal';
import { Button } from '@app/components/ui/Button';
import type { VersionInfo, UpdateDevice } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  version: VersionInfo;
  /** Pre-select a specific device by IP, or 'default' for local only */
  defaultTarget?: string;
}

type Phase = 'select' | 'running' | 'done';

const LOCAL_KEY = '__local__';

export function UpdateModal({ open, onClose, version, defaultTarget = 'default' }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<{ id: string; label: string; ip?: string }[]>([]);
  const [phase, setPhase] = useState<Phase>('select');
  const [log, setLog] = useState('');
  const [success, setSuccess] = useState(false);
  const [partial, setPartial] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const currentBranch = version.branch || 'main';

  useEffect(() => {
    if (!open) return;
    setPhase('select');
    setLog('');
    setSuccess(false);
    setPartial(false);
    setSelectedBranch(currentBranch);

    // Build device list
    const devs: { id: string; label: string; ip?: string }[] = [
      { id: LOCAL_KEY, label: 'This device (GCS)' },
    ];

    if (updateConfig.hasRemoteDevices) {
      fetchUpdateDevices()
        .then((remoteDevs: UpdateDevice[]) => {
          for (const d of remoteDevs) {
            devs.push(d);
          }
          setDevices(devs);
          applyDefaultSelection(devs);
        })
        .catch(() => {
          setDevices(devs);
          setSelected(new Set([LOCAL_KEY]));
        });
    } else {
      setDevices(devs);
      setSelected(new Set([LOCAL_KEY]));
    }

    // Fetch branches
    setLoadingBranches(true);
    listBranches()
      .then(data => {
        setBranches(data.branches);
        setSelectedBranch(data.current);
      })
      .catch(() => setBranches([currentBranch]))
      .finally(() => setLoadingBranches(false));

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentBranch, defaultTarget]);

  function applyDefaultSelection(devs: { id: string; ip?: string }[]) {
    if (defaultTarget === 'default') {
      setSelected(new Set([LOCAL_KEY]));
    } else {
      const match = devs.find(d => d.ip === defaultTarget);
      setSelected(new Set(match ? [match.id] : [LOCAL_KEY]));
    }
  }

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const toggleDevice = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
          const exitZero = data.log.includes('exit_code=0');
          const updateLanded = /Updated:.*->/.test(data.log) || data.log.includes('Already up to date');
          setSuccess(exitZero);
          setPartial(!exitZero && updateLanded);
        }
      } catch { /* polling failure is non-fatal */ }
    }, 2000);
  };

  const startUpdate = async () => {
    setPhase('running');
    setLog('Starting update...\n');

    const branchArg = selectedBranch !== currentBranch ? selectedBranch : undefined;
    const includeLocal = selected.has(LOCAL_KEY);
    const remoteIps = devices
      .filter(d => d.ip && selected.has(d.id))
      .map(d => d.ip!);

    try {
      await updateDevices(remoteIps, includeLocal, branchArg);
      startPolling();
    } catch (e) {
      setLog(prev => prev + `\nError: ${e instanceof Error ? e.message : 'Unknown error'}\n`);
      setPhase('done');
      setSuccess(false);
    }
  };

  const isBranchSwitch = selectedBranch !== currentBranch;

  return (
    <Modal open={open} onClose={onClose} title={updateConfig.modalTitle} wide>
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

          {/* Device selection — only shown when project supports remote devices */}
          {updateConfig.hasRemoteDevices && (
            <div className="border border-border rounded-lg p-3 space-y-2">
              <div className="text-sm font-medium mb-2">Devices to update:</div>
              {devices.map(dev => (
                <label key={dev.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(dev.id)}
                    onChange={() => toggleDevice(dev.id)}
                    className="accent-accent"
                  />
                  {dev.label}
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant={isBranchSwitch ? 'warning' : 'primary'}
              size="sm"
              disabled={selected.size === 0}
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
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 text-sm ${success ? 'text-success' : partial ? 'text-warning' : 'text-error'}`}>
            {success ? <CheckCircle2 className="w-4 h-4" /> : partial ? <AlertTriangle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {success ? 'Update complete!' : partial ? 'Update applied with errors — check bridge status' : 'Update failed'}
          </div>
          <pre className="bg-bg-secondary rounded-lg p-3 text-xs max-h-64 overflow-y-auto font-mono whitespace-pre-wrap">
            {log}
          </pre>
          {(success || partial) && (
            <div className="text-xs text-text-secondary">
              Reload the page to use the updated web UI.
            </div>
          )}
          <div className="flex justify-end gap-2">
            {(success || partial) && (
              <Button variant="primary" size="sm" onClick={() => {
                try { sessionStorage.setItem('update-just-applied', '1'); } catch {}
                window.location.reload();
              }}>
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
