import { describe, expect, it } from 'vitest';
import { mayEnterApplication } from './session';

describe('the application session gate', () => {
  it('admits only a signed-in session that has passed two-factor authentication', () => {
    expect(mayEnterApplication({ authenticated: true, two_factor_passed: true })).toBe(true);
    expect(mayEnterApplication({ authenticated: true, two_factor_passed: false })).toBe(false);
    expect(mayEnterApplication({ authenticated: true })).toBe(false);
    expect(mayEnterApplication({ authenticated: false, two_factor_passed: true })).toBe(false);
  });
});
