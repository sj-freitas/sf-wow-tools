import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

/** Shows the page only to people allowed to use it; everyone else goes to `fallback` (the guild's home). */
export function RequireAccess({
  allowed,
  fallback,
  children,
}: {
  allowed: boolean;
  fallback: string;
  children: ReactNode;
}) {
  return allowed ? children : <Navigate to={fallback} replace />;
}
