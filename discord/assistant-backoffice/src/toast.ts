/**
 * Small, passing notes ("Discord ID copied") shown at the bottom of the screen, over the page,
 * so they never push anything around. `showToast` from anywhere; `<Toasts />` (mounted once in
 * the app) draws them.
 */
export interface Toast {
  id: number;
  text: string;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener(toasts));

/** Shows a note for a moment (`ms`); a new one replaces any still showing. */
export function showToast(text: string, ms = 1800): void {
  const toast = { id: nextId++, text };
  toasts = [toast];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toast.id);
    emit();
  }, ms);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}
