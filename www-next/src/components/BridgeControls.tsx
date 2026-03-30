import { useState } from 'react';
import type { StatusResponse } from '../api/types';
import { executeCommand } from '../api/client';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { CommandOutput } from './CommandOutput';

interface Props {
  status: StatusResponse;
  onRefresh: () => void;
}

export function BridgeControls({ status, onRefresh }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);
  const { toast } = useToast();

  const run = async (action: string, label: string) => {
    setLoading(action);
    try {
      const res = await executeCommand(action, status.aircraft.tailscale_ip);
      if (action === 'debug') {
        setOutput({ title: `Debug Output`, text: res.output || 'No output' });
      } else {
        toast(res.success ? `${label} successful` : `${label} failed: ${res.output}`, res.success ? 'success' : 'error');
      }
      setTimeout(onRefresh, 1000);
    } catch (e) {
      toast(`${label} failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <div className="bg-bg-card rounded-xl border border-border p-4">
        <div className="text-sm font-semibold mb-3">Bridge Controls</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="success" size="sm" loading={loading === 'start'} onClick={() => run('start', 'Start')}>Start</Button>
          <Button variant="danger" size="sm" loading={loading === 'stop'} onClick={() => run('stop', 'Stop')}>Stop</Button>
          <Button variant="warning" size="sm" loading={loading === 'restart'} onClick={() => run('restart', 'Restart')}>Restart</Button>
          <Button variant="primary" size="sm" loading={loading === 'setup'} onClick={() => run('setup', 'Setup')}>Setup</Button>
          <Button variant="primary" size="sm" loading={loading === 'add'} onClick={() => run('add', 'Connect')}>Connect</Button>
          <Button variant="ghost" size="sm" loading={loading === 'debug'} onClick={() => run('debug', 'Debug')}>Debug</Button>
        </div>
        {status.version.update_available && (
          <div className="mt-3 text-xs text-warning">
            Update available: {status.version.current} &rarr; {status.version.latest}
          </div>
        )}
      </div>

      <CommandOutput
        open={output !== null}
        onClose={() => setOutput(null)}
        title={output?.title || ''}
        output={output?.text || ''}
      />
    </>
  );
}
