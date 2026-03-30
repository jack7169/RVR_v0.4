import { useState, useEffect, useCallback } from 'react';
import { listFiles, deleteFile, getDownloadUrl } from '../api/client';
import type { FileInfo } from '../api/types';
import { Button } from './ui/Button';
import { formatBytes } from '../lib/utils';
import { useToast } from './ui/Toast';

export function FileManager() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await listFiles();
      setFiles(data.files);
    } catch {
      // May fail if no files exist yet
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (name: string) => {
    try {
      await deleteFile(name);
      toast('File deleted', 'success');
      refresh();
    } catch {
      toast('Delete failed', 'error');
    }
  };

  const captures = files.filter(f => f.type === 'capture');
  const logs = files.filter(f => f.type === 'log');

  return (
    <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-semibold">Files</span>
        <Button size="sm" variant="ghost" onClick={refresh}>Refresh</Button>
      </div>
      <div className="p-4 space-y-4">
        {captures.length > 0 && (
          <div>
            <div className="text-xs text-text-secondary mb-2 uppercase tracking-wider">Captures</div>
            <div className="space-y-1">
              {captures.map(f => (
                <FileRow key={f.name} file={f} onDelete={handleDelete} />
              ))}
            </div>
          </div>
        )}
        {logs.length > 0 && (
          <div>
            <div className="text-xs text-text-secondary mb-2 uppercase tracking-wider">Logs</div>
            <div className="space-y-1">
              {logs.map(f => (
                <FileRow key={f.name} file={f} />
              ))}
            </div>
          </div>
        )}
        {files.length === 0 && (
          <div className="text-sm text-text-secondary italic">No files available</div>
        )}
      </div>
    </div>
  );
}

function FileRow({ file, onDelete }: { file: FileInfo; onDelete?: (name: string) => void }) {
  return (
    <div className="flex items-center justify-between text-sm bg-bg-input rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs">
          {file.type === 'capture' ? '\u{1F4E6}' : '\u{1F4C4}'}
        </span>
        <span className="truncate font-mono text-xs">{file.name}</span>
        <span className="text-text-secondary text-xs whitespace-nowrap">{formatBytes(file.size)}</span>
      </div>
      <div className="flex gap-1 ml-2">
        <a
          href={getDownloadUrl(file.name)}
          download={file.name}
          className="text-xs text-accent hover:text-accent-hover px-2 py-1 rounded hover:bg-accent/10 transition-colors"
        >
          Download
        </a>
        {onDelete && (
          <button
            onClick={() => onDelete(file.name)}
            className="text-xs text-error hover:text-error/80 px-2 py-1 rounded hover:bg-error/10 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
