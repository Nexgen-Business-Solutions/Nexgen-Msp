import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/shared/components/LoadingScreen';
import { useSession } from '@/shared/hooks/useSession';
import { isInternal, landingFor, stillRefused } from '@/features/auth/landing';
import { forgetRefusal, rememberedRefusal, type Refusal } from '../unauthorized';

/**
 * The denial screen is a report on a decision, not a destination.
 *
 * Two things have to be true at once, and they pull in opposite directions. Somebody turned
 * away from here is owed the reason, once, with a way out offered — being silently moved
 * somewhere else answers a question they did not ask. But somebody who reloads this address
 * later, or returns to it through history, is owed nothing: the refusal may be gone, or may
 * never have concerned where they were going at all, and showing them a wall then is just a
 * wall.
 *
 * What tells the two apart is the refusal travelling in router state. It is there on the
 * redirect that reports a refusal and nowhere else — a reload drops it, which is exactly
 * the distinction needed. So a refusal carried in state is reported; otherwise the live
 * answer decides, and whoever is no longer refused goes where they actually belong.
 */
export default function UnauthorizedGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: session, isLoading } = useSession();
  const carried = (location.state as Refusal | null) ?? {};
  const held = rememberedRefusal();

  // a refusal that has just happened, rather than an address somebody came back to
  const justRefused = Boolean(carried.code);
  const landing = landingFor(session);
  const refused = !session || stillRefused(session);
  const leave = !justRefused && !refused ? landing.path : '';
  // a home outside this application is a document navigation, not a route change
  const elsewhere = leave && !isInternal(leave) ? leave : '';

  useEffect(() => {
    if (!elsewhere) return;

    forgetRefusal();
    window.location.replace(elsewhere);
  }, [elsewhere]);

  if (isLoading) return <LoadingScreen message="Checking your access…" />;

  if (elsewhere) return <LoadingScreen message="Taking you to your home…" />;

  if (leave) {
    forgetRefusal();

    return <Navigate to={leave} replace />;
  }

  // nothing refused and nothing to report: they simply typed the address
  if (!justRefused && !held.code) return <Navigate to="/msp" replace />;

  return <>{children}</>;
}
