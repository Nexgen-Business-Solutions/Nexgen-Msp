import { describe, expect, it } from 'vitest';
import { customerChanges, customerRole } from '../features/internal/customerAccess';
import { getNavForRoles } from '../shared/layout/navigation';
import type { SessionContext } from '../lib/api/session';

const session = (roles: string[]): SessionContext => ({ user: 'test@example.com', authenticated: true, roles, customers: [] });

describe('customer access', () => {
  it('requires the MSP admin role for customer administration', () => {
    expect(customerRole(session(['MSP System Admin']))).toBe('MSP System Admin');
    expect(customerRole(session(['System Manager']))).toBeNull();
    expect(customerRole()).toBeNull();
    expect(customerRole({ ...session(['MSP System Admin']), authenticated: false })).toBeNull();
  });
  it('uses the authoritative session capability when linkage restricts an admin role', () => {
    expect(customerRole({ ...session(['MSP System Admin']), customer_profile_role: null })).toBeNull();
  });
  it('never widens customer roles with a staff role', () => {
    expect(customerRole(session(['MSP System Admin', 'MSP Customer Manager']))).toBe('MSP Customer Manager');
    expect(customerRole(session(['MSP Customer Manager', 'MSP Customer Operator']))).toBe('MSP Customer Operator');
  });
  it('offers operational customer access to technicians and an own-company page to customer roles', () => {
    expect(getNavForRoles(['MSP Technician']).map((item) => item.path)).toContain('/msp/customers');
    for (const role of ['MSP Customer Manager', 'MSP Customer Operator']) {
      const paths = getNavForRoles([role]).map((item) => item.path);
      expect(paths).toContain('/msp/customer-profile');
      expect(paths).not.toContain('/msp/customers');
    }
  });
  it('submits only the manager website field from a populated profile', () => {
    expect(customerChanges({ name: 'Other', customer_name: 'Changed', website: 'https://example.com', msp_free_of_charge: 1, default_currency: 'USD', permissions: { can_edit: true, can_administer: true, can_edit_address: true } }, true))
      .toEqual({ website: 'https://example.com' });
  });
  it('keeps admin edits but excludes response metadata and linkage', () => {
    expect(customerChanges({ name: 'Other', customer_name: 'Example', website: '', msp_free_of_charge: 0, counts: { users: 1, devices: 2, contracts: 3 } }, false))
      .toEqual({ customer_name: 'Example', website: '', msp_free_of_charge: 0 });
  });
});
