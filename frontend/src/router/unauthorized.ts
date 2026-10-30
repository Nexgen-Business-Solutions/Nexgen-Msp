/**
 * Why access was refused, kept where a reload cannot lose it.
 *
 * The refusal travels in router state, which a document navigation or an F5 throws away —
 * and a denial screen with no reason on it is worse than no screen at all. The guard writes
 * it here as it redirects, the screen reads whichever of the two it has, and a verdict that
 * comes back clean wipes it so a stale reason cannot be shown to somebody now allowed in.
 */

const REASON = 'msp_unauth_code';
const MESSAGE = 'msp_unauth_message';

export const UNAUTHORIZED_PATH = '/msp/unauthorized';

export type Refusal = {
  code?: string | null;
  message?: string | null;
};

/** Session storage is unavailable in some private modes, and a refusal is not worth a crash. */
const quietly = (act: () => void) => {
  try {
    act();
  } catch {
    /* nothing to do: the reason simply will not survive a reload */
  }
};

export const rememberRefusal = ({ code, message }: Refusal) =>
  quietly(() => {
    if (code) sessionStorage.setItem(REASON, code);
    if (message) sessionStorage.setItem(MESSAGE, message);
  });

export const forgetRefusal = () =>
  quietly(() => {
    sessionStorage.removeItem(REASON);
    sessionStorage.removeItem(MESSAGE);
  });

export const rememberedRefusal = (): Refusal => {
  try {
    return {
      code: sessionStorage.getItem(REASON),
      message: sessionStorage.getItem(MESSAGE),
    };
  } catch {
    return {};
  }
};
