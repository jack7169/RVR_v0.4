import { useState } from 'react';
import { Play, Square, RotateCcw, Bug, Zap, Gauge } from 'lucide-react';
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

  const run = async (action: string, label: string, showOutput = false) => {
    setLoading(action);
    try {
      const res = await executeCommand(action, status.aircraft.tailscale_ip);
      if (showOutput) {
        setOutput({ title: label, text: res.output || 'No output' });
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

  const runSpeedtest = async () => {
    if (!status.aircraft.tailscale_ip) {
      toast('No aircraft bound', 'error');
      return;
    }
    setLoading('speedtest');
    try {
      // Use iperf3-style throughput test via l2bridge interface
      // Falls back to large ping flood if iperf not available
      const res = await executeCommand('debug', status.aircraft.tailscale_ip);
      const ip = status.aircraft.tailscale_ip;
      // Run a timed data transfer test
      const testRes = await fetch('/cgi-bin/api.cgi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'speedtest',
          aircraft_ip: ip,
        }),
      });
      const data = await testRes.json();
      setOutput({
        title: 'Speed Test Results',
        text: data.output || data.error || 'No results',
      });
    } catch (e) {
      toast(`Speed test failed: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    } finally {
      setLoading(null);
    }
  };

  const runPacketStorm = async () => {
    if (!status.aircraft.tailscale_ip) {
      toast('No aircraft bound', 'error');
      return;
    }
    setLoading('storm');
    try {
      const res = await fetch('/cgi-bin/api.cgi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'packet_storm',
          aircraft_ip: status.aircraft.tailscale_ip,
        }),
      });
      const data = await res.json();
      setOutput({
        title: 'Packet Storm Results',
        text: data.output || data.error || 'No results',
      });
    } catch (e) {
      toast(`Packet storm failed: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <div className="bg-bg-card rounded-xl border border-border p-4">
        <div className="text-sm font-semibold mb-3">Bridge Controls</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="success" size="sm" loading={loading === 'start'} onClick={() => run('start', 'Start')}><Play className="w-3 h-3" /> Start</Button>
          <Button variant="danger" size="sm" loading={loading === 'stop'} onClick={() => run('stop', 'Stop')}><Square className="w-3 h-3" /> Stop</Button>
          <Button variant="warning" size="sm" loading={loading === 'restart'} onClick={() => run('restart', 'Restart')}><RotateCcw className="w-3 h-3" /> Restart</Button>
          <Button variant="ghost" size="sm" loading={loading === 'debug'} onClick={() => run('debug', 'Debug', true)}><Bug className="w-3 h-3" /> Debug</Button>
        </div>

        <div className="text-sm font-semibold mt-4 mb-2">Link Tests</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={loading === 'speedtest'} onClick={runSpeedtest} disabled={!status.aircraft.tailscale_ip}>
            <Gauge className="w-3 h-3" /> Speed Test
          </Button>
          <Button variant="warning" size="sm" loading={loading === 'storm'} onClick={runPacketStorm} disabled={!status.aircraft.tailscale_ip}>
            <Zap className="w-3 h-3" /> Packet Storm
          </Button>
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
