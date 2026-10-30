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

/**
 * What each refusal means, in words.
 *
 * The server answers in stable codes on purpose — a code is safe to log, to compare and to
 * keep across versions, and it says nothing about other people's rules or accounts. The
 * sentence belongs here, with the rest of what the application says out loud. Anything the
 * server does send a message for wins over this.
 */
export const REASONS: Record<string, string> = {
  NOT_SIGNED_IN: 'You are not signed in.',
  NO_LOGIN_RULE:
    'Nothing says where this account belongs on this site. Ask an administrator to give it ' +
    'a home.',
  AMBIGUOUS_DIRECT_RULE:
    'This account is sent to two places at once. An administrator has to leave only one.',
  AMBIGUOUS_ROLE_RULE:
    'Two rules of equal standing claim this account, so neither is applied. Ask an ' +
    'administrator to settle which one holds.',
  RULE_DISABLED: 'The home set for this account is switched off. Ask an administrator to restore it.',
  USER_DISABLED: 'This account is disabled.',
  INVALID_HOME_ROUTE:
    'The home set for this account is not a place on this site. Ask an administrator to ' +
    'correct it.',
  TARGET_NOT_REGISTERED:
    'The home set for this account points at an application this site does not serve.',
  MSP_ACCESS_DENIED:
    'This account is sent to Nexgen MSP but is not allowed in it. Ask an administrator what ' +
    'access it should have.',
  DESK_ACCESS_DENIED: 'This account is sent to the Desk but is not allowed to open it.',
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
