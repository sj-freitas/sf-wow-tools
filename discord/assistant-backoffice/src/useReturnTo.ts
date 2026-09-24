import { useLocation } from 'react-router-dom';

/** Where a create/edit page came from (with its search and page), so saving or cancelling goes back there. */
export function useReturnTo(fallback: string): string {
  const state = useLocation().state as { from?: string } | null;
  return state?.from && state.from.startsWith('/') ? state.from : fallback;
}

/** The current address, to hand to a link so the page it opens can return here. */
export function useCurrentUrl(): string {
  const location = useLocation();
  return location.pathname + location.search;
}
