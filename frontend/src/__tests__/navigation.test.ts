import { describe, expect, it } from 'vitest';
import {
  getPagesForRoles,
  CUSTOMER_OPERATOR_ROLE,
  INTERNAL_ROLES,
  CUSTOMER_MANAGER_ROLE,
  getNavForRoles,
  getSectionsForRoles,
  isAdmin,
  isPortalOnly,
} from '../shared/layout/navigation';

const ADMIN = 'MSP System Admin';
const TECH = 'MSP Technician';
const MANAGER = 'MSP Customer Manager';
const OPERATOR = 'MSP Customer Operator';

const paths = (roles: string[]) => getNavForRoles(roles).map((item) => item.path);
const labels = (roles: string[]) =>
  getSectionsForRoles(roles).flatMap((section) => section.items.map((item) => item.label));

describe('what the sidebar offers each role', () => {
  it('names the customer roles the same way the backend does', () => {
    expect(CUSTOMER_MANAGER_ROLE).toBe(MANAGER);
    expect(CUSTOMER_OPERATOR_ROLE).toBe(OPERATOR);
  });

  it('keeps the operator out of the internal family', () => {
    expect(INTERNAL_ROLES).not.toContain(OPERATOR);
    expect(INTERNAL_ROLES).not.toContain(MANAGER);
    expect(INTERNAL_ROLES).toContain(ADMIN);
    expect(INTERNAL_ROLES).toContain(TECH);
  });

  it('treats only customer roles as portal-only', () => {
    expect(isPortalOnly([MANAGER])).toBe(true);
    expect(isPortalOnly([OPERATOR])).toBe(true);
    expect(isPortalOnly([ADMIN])).toBe(false);
    expect(isPortalOnly([TECH])).toBe(false);
  });

  it('does not treat a contact as staff when a staff role was added by hand', () => {
    // the menu follows the same rule as the backend: a customer role means the portal
    expect(isPortalOnly([MANAGER, TECH])).toBe(false);
  });

  it('reserves the commercial screens for the administrator', () => {
    expect(isAdmin([ADMIN])).toBe(true);
    expect(isAdmin([TECH])).toBe(false);
    expect(isAdmin([MANAGER])).toBe(false);
    expect(isAdmin([OPERATOR])).toBe(false);
  });
});

describe('the invoices', () => {
  it('are offered to the customer manager', () => {
    expect(paths([MANAGER])).toContain('/msp/invoices');
  });

  it('are hidden from the customer operator', () => {
    expect(paths([OPERATOR])).not.toContain('/msp/invoices');
  });

  it('are the only difference between the two customer roles', () => {
    const manager = paths([MANAGER]).filter((path) => path !== '/msp/invoices');
    const operator = paths([OPERATOR]);

    expect(operator).toEqual(manager);
  });
});

describe('what a customer never sees', () => {
  const forbidden = ['/msp/customers', '/msp/billing', '/msp/accounts', '/msp/settings', '/msp/activity'];

  it.each([MANAGER, OPERATOR])('%s is offered none of the internal screens', (role) => {
    const offered = paths([role]);

    for (const path of forbidden) {
      expect(offered).not.toContain(path);
    }
  });
});

describe('what staff see', () => {
  it('gives a technician the operations screens but not the commercial ones', () => {
    const offered = paths([TECH]);

    expect(offered).toContain('/msp/requests');
    expect(offered).toContain('/msp/users');
    expect(offered).toContain('/msp/devices');
    expect(offered).not.toContain('/msp/billing');
    expect(offered).not.toContain('/msp/accounts');
  });

  it('gives an administrator everything', () => {
    const offered = paths([ADMIN]);

    for (const path of ['/msp/requests', '/msp/users', '/msp/devices', '/msp/customers',
                        '/msp/billing', '/msp/accounts', '/msp/settings']) {
      expect(offered).toContain(path);
    }
  });

  it('never offers staff the portal-only pages', () => {
    expect(labels([ADMIN])).not.toContain('Portal Dashboard');
    expect(labels([TECH])).not.toContain('Portal Dashboard');
  });
});

describe('an account with no role', () => {
  it('is not treated as a customer', () => {
    expect(isPortalOnly([])).toBe(false);
  });
});

describe('someone who only decides at their company', () => {
  it('is not offered the New Request entry', () => {
    const roles = ['MSP Customer Manager'];
    const offered = getPagesForRoles(roles, true).map((item) => item.id);
    const withheld = getPagesForRoles(roles, false).map((item) => item.id);

    expect(offered).toContain('portal-new-request');
    expect(withheld).not.toContain('portal-new-request');
    expect(withheld.length).toBe(offered.length - 1);
  });

  it('changes nothing for staff, who never go through the matrix', () => {
    const roles = ['MSP Technician'];
    expect(getPagesForRoles(roles, false)).toEqual(getPagesForRoles(roles, true));
  });
});
