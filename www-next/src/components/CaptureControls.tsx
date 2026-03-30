import { useState } from 'react';
import type { StatusResponse } from '../api/types';
import { startCapture, stopCapture } from '../api/client';
import { Button } from './ui/Button';
import { formatBytes } from '../lib/utils';
import { useToast } from './ui/Toast';
import { cn } from '../lib/utils';

interface Props {
  status: StatusResponse;
  onRefresh: () => void;
}

export function CaptureControls({ status, onRefresh }: Props) {
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { capture } = status;

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await startCapture(duration);
      toast(res.success ? 'Capture started' : `Failed: ${res.output}`, res.success ? 'success' : 'error');
      setTimeout(onRefresh, 1000);
    } catch (e) {
      toast(`Capture failed: ${e instanceof Error ? e.message : 'Error'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopCapture();
      toast('Capture stopped', 'success');
      setTimeout(onRefresh, 1000);
    } catch (e) {
      toast(`Stop failed: ${e instanceof Error ? e.message : 'Error'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        {capture.active && (
          <span className={cn('w-2.5 h-2.5 rounded-full bg-error animate-[pulse-dot_1s_infinite]')} />
        )}
        <span className="text-sm font-semibold">Packet Capture</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!capture.active ? (
          <>
            <input
              type="number"
              min={5}
              max={3600}
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="bg-bg-input border border-border rounded-lg px-3 py-1.5 text-sm w-20 text-text-primary"
            />
            <span className="text-text-secondary text-xs">seconds</span>
            <Button size="sm" variant="danger" loading={loading} onClick={handleStart}>Start Capture</Button>
          </>
        ) : (
          <>
            <span className="text-sm text-error font-mono">
              Recording... {capture.elapsed}s
            </span>
            <Button size="sm" variant="ghost" loading={loading} onClick={handleStop}>Stop</Button>
          </>
        )}
      </div>

      {capture.file_size > 0 && (
        <div className="mt-2 text-xs text-text-secondary">
          Capture file: {formatBytes(capture.file_size)}
        </div>
      )}
    </div>
  );
}
