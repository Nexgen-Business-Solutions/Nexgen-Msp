import { describe, expect, it } from 'vitest';
import { ADVISORY_EXCEPTIONS, isAdvisory, isBlocking } from './billingExceptions';

describe('which exceptions hold a run back', () => {
  it('treats a period already paid for as a remark, not a problem', () => {
    expect(isAdvisory('Already Covered')).toBe(true);
    expect(isBlocking('Already Covered')).toBe(false);
  });

  it('still blocks on everything somebody has to act on', () => {
    for (const code of [
      'Missing Rate',
      'Invalid Dates',
      'Unapproved Override',
      'Negative Quantity',
      'Missing Customer Mapping',
      'Overlapping Assignment',
      'Already Invoiced',
    ]) {
      expect(isBlocking(code), code).toBe(true);
      expect(isAdvisory(code), code).toBe(false);
    }
  });

  it('says nothing about a line that carries no exception at all', () => {
    for (const nothing of [null, undefined, '']) {
      expect(isBlocking(nothing)).toBe(false);
      expect(isAdvisory(nothing)).toBe(false);
    }
  });

  it('keeps the advisory list in step with the server', () => {
    // nexgen_msp/nexgen_msp/doctype/msp_billing_run/msp_billing_run.py
    expect(ADVISORY_EXCEPTIONS).toEqual(['Already Covered']);
  });
});
