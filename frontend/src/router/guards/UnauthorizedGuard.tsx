import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { rememberedRefusal, type Refusal } from '../unauthorized';

/**
 * The denial screen is a report on a decision, not a destination.
 *
 * Typed as a URL, or returned to through history, it would otherwise show "Access denied" to
 * somebody nothing had denied. Without a refusal behind it there is nothing to report, so
 * send them where they were actually going and let `AccessGuard` decide again.
 */
export default function UnauthorizedGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const carried = (location.state as Refusal | null) ?? {};
  const held = rememberedRefusal();

  if (!carried.code && !held.code) return <Navigate to="/msp" replace />;

  return <>{children}</>;
}
