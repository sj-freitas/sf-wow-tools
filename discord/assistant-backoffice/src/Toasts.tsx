import { useEffect, useState } from 'react';
import { subscribeToasts, type Toast } from './toast';

/** Where `showToast` notes appear: bottom centre, over the page; read out politely. */
export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const unsubscribe = subscribeToasts(setToasts);
    return () => {
      unsubscribe();
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
