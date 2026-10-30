import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';
import { isInternal, landingFor, stillRefused } from '@/features/auth/landing';
import { forgetRefusal, rememberedRefusal, type Refusal } from '../unauthorized';

/**
 * The denial screen is a report on a decision, not a destination.
 *
 * Typed as a URL, or returned to through history, it would otherwise show "Access denied" to
 * somebody nothing had denied. Three ways that happens, and all three send them where they
 * were actually going: no refusal behind it at all; a refusal the server has since stopped
 * making, because an administrator put the access right; and a refusal that was never about
 * where this account is going — one whose home is the desk is kept out of this application
 * for ever, and that is not a reason to hold it here.
 *
 * So the live answer outranks the remembered one, and what counts as still refused is asked
 * in the one place the denial screen's own button asks it.
 */
export default function UnauthorizedGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading } = useSession();
  const carried = (location.state as Refusal | null) ?? {};
  const held = rememberedRefusal();

  const landing = landingFor(session);
  const refused = !session || stillRefused(session);
  // a home outside this application is a document navigation, not a route change
  const elsewhere = !refused && !isInternal(landing.path) ? landing.path : '';

  useEffect(() => {
    if (!elsewhere) return;

    forgetRefusal();
    window.location.replace(elsewhere);
  }, [elsewhere]);

  if (isLoading) return <LoadingScreen message="Checking your access…" />;

  if (elsewhere) return <LoadingScreen message="Taking you to your home…" />;

  if (!refused) {
    forgetRefusal();

    return <Navigate to={landing.path} replace />;
  }

  if (!carried.code && !held.code) return <Navigate to="/msp" replace />;

  return <>{children}</>;
}
