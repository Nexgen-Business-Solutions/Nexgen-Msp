import type { SessionContext } from '@/lib/api/session';
import { UNAUTHORIZED_PATH } from '@/router/unauthorized';

/**
 * Where a signed-in account goes, and whether the route it asked for may be honoured.
 *
 * Signing in used to end in one place, because there was only one place to end. Now the
 * server decides, and this applies that decision — it does not take it. Two things it must
 * never do: send somebody to a route the server did not authorise, and let a route somebody
 * typed carry them outside the destination they were given.
 */

export const APPLICATION = '/msp';

const unsafe = (path: string) =>
  [...path].some((character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || code < 32 || code === 127;
  });

/**
 * A requested route, kept only when it belongs to the destination that was granted.
 *
 * `redirect-to` is navigation data, never a permission. A route of another family is
 * dropped rather than refused: the account still has somewhere to be.
 */
export const keepRequested = (requested: unknown, destination: string) => {
  if (typeof requested !== 'string') return destination;

  const path = requested.trim();

  if (!path.startsWith('/') || path.startsWith('//') || unsafe(path)) return destination;

  const belongs =
    path === destination || ['/', '?', '#'].some((edge) => path.startsWith(`${destination}${edge}`));

  return belongs ? path : destination;
};

export type Landing = { path: string; code: string | null };

/** The one place that turns a session into a place to be. */
export const landingFor = (
  session?: Pick<SessionContext, 'login_destination'> | null,
  requested?: unknown
): Landing => {
  const destination = session?.login_destination;

  // no destination means a server that is not routing by rules yet, so nothing changes
  if (!destination) return { path: keepRequested(requested, APPLICATION), code: null };

  if (!destination.success) return { path: UNAUTHORIZED_PATH, code: destination.error };

  return { path: keepRequested(requested, destination.path || APPLICATION), code: null };
};

/** Whether a path is inside this application, and so reachable without leaving the page. */
export const isInternal = (path: string) =>
  path === APPLICATION || path.startsWith(`${APPLICATION}/`) || path.startsWith(`${APPLICATION}?`);
