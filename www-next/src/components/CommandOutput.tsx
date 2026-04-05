import { useEffect, useRef } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  output: string;
  streaming?: boolean;
}

export function CommandOutput({ open, onClose, title, output, streaming }: Props) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <Modal open={open} onClose={onClose} title={title} wide footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <pre
        ref={preRef}
        className="bg-[#0d1117] rounded-lg p-4 font-mono text-xs whitespace-pre-wrap break-all max-h-96 overflow-y-auto text-text-primary"
      >
        {output}
        {streaming && <span className="inline-block w-2 h-3.5 bg-text-secondary/60 animate-pulse ml-0.5 align-text-bottom" />}
      </pre>
    </Modal>
  );
}
