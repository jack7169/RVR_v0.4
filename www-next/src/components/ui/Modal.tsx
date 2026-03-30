import * as Dialog from '@radix-ui/react-dialog';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, footer, wide }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-200 bg-black/60 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-200 w-full -translate-x-1/2 -translate-y-1/2 ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] flex flex-col rounded-xl border border-border bg-bg-card shadow-2xl data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out`}
          onEscapeKeyDown={() => onClose()}
          onPointerDownOutside={() => onClose()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Dialog.Title className="font-semibold text-lg text-text-primary">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                onClick={onClose}
                className="text-text-secondary hover:text-text-primary text-xl leading-none"
              >
                &times;
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className="p-6 overflow-y-auto flex-1">
              {children}
            </div>
          </Dialog.Description>
          {footer && (
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
