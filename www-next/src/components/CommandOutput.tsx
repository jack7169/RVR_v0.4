import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  output: string;
}

export function CommandOutput({ open, onClose, title, output }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <pre className="bg-[#0d1117] rounded-lg p-4 font-mono text-xs whitespace-pre-wrap break-all max-h-96 overflow-y-auto text-text-primary">
        {output}
      </pre>
    </Modal>
  );
}
