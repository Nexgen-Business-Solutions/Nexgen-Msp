import { FrappeError } from '@/lib/api/client';

/**
 * What the refusal was about, said in the words of the step it happened on.
 *
 * Both steps of signing in answer 401, so reading the status alone told somebody who mistyped
 * their code that their password was wrong. The server names what it refused, and that name is
 * what the screen has to repeat.
 */
const SIGN_IN_REFUSALS: Record<string, string> = {
  // the second step: about the code, never about the password
  OTP_INVALID: 'Invalid code. Please try again.',
  OTP_REQUIRED: 'Enter the 6-digit code from your authenticator.',
  OTP_INVALID_FORMAT: 'The code is 6 digits.',
  // the token the first step minted is gone: five minutes, or too many wrong codes
  PENDING_LOGIN_INVALID: 'This sign-in has expired. Please start again.',
  RATE_LIMITED: 'Too many attempts. Please wait before trying again.',
  // the first step, and the only one this is ever true of
  AUTHENTICATION_FAILED: 'Incorrect username or password.',
  USER_DISABLED: 'This account cannot sign in. Ask Nexgen to reopen it.',
  // the account has no second factor yet, which is a setup to finish, not a refusal
  TWO_FA_SETUP_REQUIRED: 'Set up your authenticator to finish signing in.',
  TWO_FA_NOT_CONFIGURED: 'This account has no authenticator on file yet.',
  SETUP_EXPIRED: 'The setup has expired. Please start again.',
};

export const errorMessageFor = (err: unknown) => {
  if (err instanceof FrappeError) {
    const named = err.code ? SIGN_IN_REFUSALS[err.code] : undefined;

    if (named) return named;

    if (err.status === 401) return 'Incorrect username or password.';
    if (err.status === 403) return 'Your account is not allowed to sign in.';
    if (err.status === 417) return err.message || 'Sign-in refused.';
    if (err.status === 428) return err.message || 'A verification code is required.';
    if (err.status === 429) return err.message || 'Too many attempts. Try again shortly.';
    if (err.status >= 500) return 'The server is unavailable. Please try again later.';
    return err.message || 'Sign-in failed.';
  }

  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';

  return 'An unexpected error occurred.';
};
