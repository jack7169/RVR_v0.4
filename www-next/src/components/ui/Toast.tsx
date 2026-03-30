import { useCallback } from 'react';
import { toast as sonnerToast, Toaster } from 'sonner';

type ToastType = 'success' | 'error' | 'info';

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

export function useToast(): ToastContextType {
  const toast = useCallback((message: string, type: ToastType = 'info') => {
    switch (type) {
      case 'success':
        sonnerToast.success(message);
        break;
      case 'error':
        sonnerToast.error(message);
        break;
      case 'info':
        sonnerToast.info(message);
        break;
    }
  }, []);

  return { toast };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        theme="dark"
        position="top-right"
        richColors
        closeButton
        duration={4000}
      />
    </>
  );
}
