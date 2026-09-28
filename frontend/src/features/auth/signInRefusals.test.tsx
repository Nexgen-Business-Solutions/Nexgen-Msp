import { describe, expect, it } from 'vitest';
import { FrappeError } from '@/lib/api/client';
import { errorMessageFor } from './signInRefusals';

/**
 * What the sign-in screen says when it is refused.
 *
 * Both steps answer 401, so reading the status alone told somebody who mistyped their
 * six-digit code that their password was wrong — and told somebody whose sign-in had simply
 * expired the same thing. The server names what it refused; these pin that the screen repeats
 * that name rather than guessing from the number.
 */

const refused = (code: string, message = 'from the server') =>
  new FrappeError(message, 401, code);

describe('what the sign-in screen says it was refused for', () => {
  it('blames the code when the code was wrong, never the password', () => {
    const said = errorMessageFor(refused('OTP_INVALID'));

    expect(said).toBe('Invalid code. Please try again.');
    expect(said).not.toMatch(/password/i);
  });

  it('says the sign-in expired rather than accusing the password', () => {
    const said = errorMessageFor(refused('PENDING_LOGIN_INVALID'));

    expect(said).toBe('This sign-in has expired. Please start again.');
    expect(said).not.toMatch(/password/i);
  });

  it('still blames the password when the password really was wrong', () => {
    expect(errorMessageFor(refused('AUTHENTICATION_FAILED'))).toBe(
      'Incorrect username or password.'
    );
  });

  it('names every refusal the two sign-in steps can send', () => {
    const codes = [
      'OTP_INVALID',
      'OTP_REQUIRED',
      'OTP_INVALID_FORMAT',
      'PENDING_LOGIN_INVALID',
      'RATE_LIMITED',
      'AUTHENTICATION_FAILED',
      'USER_DISABLED',
      'TWO_FA_SETUP_REQUIRED',
      'TWO_FA_NOT_CONFIGURED',
      'SETUP_EXPIRED',
    ];

    for (const code of codes) {
      const said = errorMessageFor(refused(code));

      expect(said, `${code} has no words of its own`).not.toBe('from the server');
      expect(said.length, `${code} says nothing`).toBeGreaterThan(0);
    }
  });

  it('falls back to the status when the server names nothing', () => {
    expect(errorMessageFor(new FrappeError('x', 401))).toBe('Incorrect username or password.');
    expect(errorMessageFor(new FrappeError('x', 403))).toBe(
      'Your account is not allowed to sign in.'
    );
  });
});
