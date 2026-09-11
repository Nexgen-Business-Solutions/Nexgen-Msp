import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../lib/api/session';
import type { CustomerDetails } from '../lib/api/internal';
import CustomerModal from '../features/internal/components/CustomerModal';

const mocks = vi.hoisted(() => ({ session: undefined as SessionContext | undefined }));
vi.mock('../shared/hooks/useSession', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('../features/internal/hooks/useCustomerDetails', () => ({
  useCustomerOptions: () => ({ data: { countries: ['Lebanon'] }, isLoading: false, isError: false }),
  useCreateCustomer: () => ({ isLoading: false, reset: vi.fn() }),
  useSaveCustomerDetails: () => ({ isLoading: false, reset: vi.fn() }),
}));
vi.mock('../shared/components/Modal', () => ({ default: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) => open ? <div>{children}{footer}</div> : null }));

const profile: CustomerDetails = {
  name: 'Customer A', customer_name: 'Customer A',
  permissions: { can_edit: true, can_administer: false, can_edit_address: true },
};
const asRole = (role: SessionContext['customer_profile_role']) => {
  mocks.session = { user: 'test@example.com', authenticated: true, roles: role ? [role] : [], customers: ['Customer A'], customer_profile_role: role };
};

describe('customer form permissions', () => {
  beforeEach(() => { mocks.session = undefined; });

  it('shows the admin creation form with required and commercial fields', () => {
    asRole('MSP System Admin');
    const html = renderToStaticMarkup(<CustomerModal open onClose={() => {}} />);
    expect(html).toContain('Create Customer');
    expect(html).toContain('Billing preferences');
    expect(html).toContain('Territory');
    expect(html).toContain('Name, type, group, and territory are required.');
  });

  it('shows only profile/contact editing to the manager', () => {
    asRole('MSP Customer Manager');
    const html = renderToStaticMarkup(<CustomerModal open customer={profile.name} details={profile} onClose={() => {}} />);
    expect(html).toContain('Website');
    expect(html).toContain('Customer contacts');
    expect(html).toContain('Billing address');
    for (const label of ['Billing preferences', 'Territory', 'Tax ID', 'Payment terms', 'Served free of charge']) {
      expect(html).not.toContain(label);
    }
  });

  it.each(['MSP Technician', 'MSP Customer Operator', null] as const)('does not open edit or create controls for %s even with stale editable detail data', (role) => {
    asRole(role);
    expect(renderToStaticMarkup(<CustomerModal open customer={profile.name} details={profile} onClose={() => {}} />)).toBe('');
    expect(renderToStaticMarkup(<CustomerModal open onClose={() => {}} />)).toBe('');
  });
});
