import { describe, expect, it } from 'vitest';
import { money } from './format';

describe('how Billing writes an amount', () => {
  it('prints a charge as it stands', () => {
    expect(money(100, 'USD')).toBe('100.00 USD');
  });

  it('prints the direction it was given, so a credit reads as a deduction', () => {
    expect(money(-23.48, 'USD')).toBe('−23.48 USD');
  });

  it('adds no sign of its own, so a credit never gets two', () => {
    expect(money(-23.48, 'USD').match(/−/g)).toHaveLength(1);
  });

  it('says nothing about an amount it was not given', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });

  it('writes zero without a sign', () => {
    expect(money(0, 'XAF')).toBe('0.00 XAF');
  });
});
