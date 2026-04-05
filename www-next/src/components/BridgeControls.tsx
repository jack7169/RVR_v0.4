import { useState, useRef } from 'react';
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
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef<EventSource | null>(null);
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

  const runStreamingTest = (action: string, title: string, loadingKey: string) => {
    const ip = status.aircraft.tailscale_ip;
    if (!ip) {
      toast('No aircraft bound', 'error');
      return;
    }

    // Close any existing stream
    esRef.current?.close();

    setLoading(loadingKey);
    setStreaming(true);
    setOutput({ title, text: '' });

    const es = new EventSource(`/cgi-bin/test-stream.cgi?action=${action}&ip=${encodeURIComponent(ip)}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.output) {
          setOutput(prev => prev ? { ...prev, text: prev.text + (prev.text ? '\n\n' : '') + data.output } : prev);
        }
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('done', () => {
      es.close();
      esRef.current = null;
      setLoading(null);
      setStreaming(false);
    });

    es.addEventListener('error', (event) => {
      // Check if this is a custom error event with data
      const me = event as MessageEvent;
      if (me.data) {
        try {
          const data = JSON.parse(me.data);
          if (data.error) {
            setOutput(prev => prev ? { ...prev, text: prev.text + '\n\nError: ' + data.error } : prev);
          }
        } catch { /* ignore */ }
      }
      es.close();
      esRef.current = null;
      setLoading(null);
      setStreaming(false);
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
        setLoading(null);
        setStreaming(false);
      }
    };
  };

  const handleClose = () => {
    esRef.current?.close();
    esRef.current = null;
    setLoading(null);
    setStreaming(false);
    setOutput(null);
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
          <Button variant="primary" size="sm" loading={loading === 'speedtest'} onClick={() => runStreamingTest('speedtest', 'Speed Test Results', 'speedtest')} disabled={!status.aircraft.tailscale_ip}>
            <Gauge className="w-3 h-3" /> Speed Test
          </Button>
          <Button variant="warning" size="sm" loading={loading === 'storm'} onClick={() => runStreamingTest('packet_storm', 'Packet Storm Results', 'storm')} disabled={!status.aircraft.tailscale_ip}>
            <Zap className="w-3 h-3" /> Packet Storm
          </Button>
        </div>

      </div>

      <CommandOutput
        open={output !== null}
        onClose={handleClose}
        title={output?.title || ''}
        output={output?.text || ''}
        streaming={streaming}
      />
    </>
  );
}
