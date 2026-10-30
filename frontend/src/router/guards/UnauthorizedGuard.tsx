import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';
import { landingFor } from '@/features/auth/landing';
import { forgetRefusal, rememberedRefusal, type Refusal } from '../unauthorized';

/**
 * The denial screen is a report on a decision, not a destination.
 *
 * Typed as a URL, or returned to through history, it would otherwise show "Access denied" to
 * somebody nothing had denied. Two ways that happens, and both send them where they were
 * actually going instead: no refusal behind it at all, and a refusal the server has since
 * stopped making — an administrator puts the access right, the person reloads this address,
 * and the reason left in session storage would keep showing them a wall that is gone.
 *
 * The live answer therefore outranks the remembered one, and a refusal is only reported
 * while the server is still making it.
 */
export default function UnauthorizedGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading } = useSession();
  const carried = (location.state as Refusal | null) ?? {};
  const held = rememberedRefusal();

  if (isLoading) return <LoadingScreen message="Checking your access…" />;

  const landing = landingFor(session);
  const refused = session?.access?.ok === false || Boolean(landing.code);

  if (session && !refused) {
    forgetRefusal();

    return <Navigate to={landing.path} replace />;
  }

  if (!refused && !carried.code && !held.code) return <Navigate to="/msp" replace />;

  return <>{children}</>;
}
