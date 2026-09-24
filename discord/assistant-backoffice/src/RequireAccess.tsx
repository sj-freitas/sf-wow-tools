import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

/** Shows the page only to people allowed to use it; everyone else goes to the home page. */
export function RequireAccess({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? children : <Navigate to="/" replace />;
}
