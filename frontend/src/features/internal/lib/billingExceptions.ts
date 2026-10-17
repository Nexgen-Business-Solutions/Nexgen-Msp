/**
 * A line can carry an exception without anything being wrong with it.
 *
 * "Already Covered" is the ordinary outcome of a catch-up run: the period was paid for by
 * the billing that preceded this application, so the line is nil on purpose. Calling that
 * blocked sends somebody looking for a problem that does not exist, and the server does not
 * block on it either.
 */
export const ADVISORY_EXCEPTIONS = ['Already Covered'];

export const isAdvisory = (code?: string | null) =>
  Boolean(code && ADVISORY_EXCEPTIONS.includes(code));

export const isBlocking = (code?: string | null) => Boolean(code) && !isAdvisory(code);
