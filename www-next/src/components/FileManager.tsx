import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Download, Trash2, RefreshCw, FileText, Package } from 'lucide-react';
import { listFiles, deleteFile, getDownloadUrl } from '../api/client';
import type { FileInfo } from '../api/types';
import { Button } from './ui/Button';
import { formatBytes } from '../lib/utils';
import { useToast } from './ui/Toast';

export function FileManager() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await listFiles();
      setFiles(data.files);
    } catch {
      // May fail if no files exist yet
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (name: string) => {
    setDeleting(name);
    try {
      await deleteFile(name);
      toast('File deleted', 'success');
      refresh();
    } catch {
      toast('Delete failed', 'error');
    } finally {
      setDeleting(null);
    }
  };

  const captures = files.filter(f => f.type === 'capture');
  const logs = files.filter(f => f.type === 'log');

  return (
    <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-semibold">Files</span>
        <Button size="sm" variant="ghost" onClick={refresh} loading={refreshing}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="p-4 space-y-4">
        {captures.length > 0 && (
          <div>
            <div className="text-xs text-text-secondary mb-2 uppercase tracking-wider">Captures</div>
            <div className="space-y-1">
              {captures.map(f => (
                <FileRow key={f.name} file={f} onDelete={handleDelete} deleting={deleting === f.name} />
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

function FileRow({ file, onDelete, deleting }: { file: FileInfo; onDelete?: (name: string) => void; deleting?: boolean }) {
  const modified = file.modified ? formatDistanceToNow(new Date(file.modified), { addSuffix: true }) : '';
  const Icon = file.type === 'capture' ? Package : FileText;

  return (
    <div className="flex items-center justify-between text-sm bg-bg-input rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-text-secondary/60 flex-shrink-0" />
        <span className="truncate font-mono text-xs">{file.name}</span>
        <span className="text-text-secondary text-xs whitespace-nowrap">{formatBytes(file.size)}</span>
        {modified && <span className="text-text-secondary/50 text-xs whitespace-nowrap">{modified}</span>}
      </div>
      <div className="flex gap-1 ml-2">
        <a
          href={getDownloadUrl(file.name)}
          download={file.name}
          className="p-1.5 text-accent hover:text-accent-hover rounded hover:bg-accent/10 transition-colors"
          title="Download"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
        {onDelete && (
          <button
            onClick={() => onDelete(file.name)}
            disabled={deleting}
            className="p-1.5 text-error hover:text-error/80 rounded hover:bg-error/10 transition-colors disabled:opacity-50"
            title="Delete"
          >
            {deleting
              ? <span className="block w-3.5 h-3.5 border-2 border-error/30 border-t-error rounded-full animate-[spin_0.8s_linear_infinite]" />
              : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
