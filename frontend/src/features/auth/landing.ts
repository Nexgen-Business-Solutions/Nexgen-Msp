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
 * Whether a path climbs out of wherever it appears to be.
 *
 * `/msp/../desk` begins with `/msp/` and is `/desk` by the time a browser has resolved it,
 * and `%2e%2e` is the same trick with the segment check stepped around. Only the part
 * before a query or a fragment is read: an escape is ordinary inside a query string.
 */
const climbs = (path: string) => {
  const route = path.split(/[?#]/)[0];

  return (
    /%(2e|2f|5c|25)/i.test(route) ||
    route.split('/').some((segment) => segment === '.' || segment === '..')
  );
};

/**
 * A requested route, kept only when it belongs to the destination that was granted.
 *
 * `redirect-to` is navigation data, never a permission. A route of another family is
 * dropped rather than refused: the account still has somewhere to be.
 */
export const keepRequested = (requested: unknown, destination: string) => {
  if (typeof requested !== 'string') return destination;

  const path = requested.trim();

  if (!path.startsWith('/') || path.startsWith('//') || unsafe(path) || climbs(path)) {
    return destination;
  }

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

/**
 * Whether this session is still being refused somewhere it is actually trying to go.
 *
 * Two refusals exist and they are not the same question. A destination that will not resolve
 * is a refusal wherever the account was headed. Being kept out of this application is only a
 * refusal if this application is where it was headed — an account whose home is the desk
 * holds no role of ours and never will, and holding it on a denial screen for that would be
 * telling it off for something that is not its problem.
 *
 * Asked in one place so that the screen and the guard cannot disagree about it.
 */
export const stillRefused = (session?: SessionContext | null) => {
  const landing = landingFor(session);

  if (landing.code) return true;

  const asksForMsp = !session?.login_destination || isInternal(landing.path);

  return asksForMsp && session?.access?.ok === false;
};
