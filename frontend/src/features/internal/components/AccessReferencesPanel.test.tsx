import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { AccountAccess } from '@/lib/api/internal';
import AccessReferencesPanel from './AccessReferencesPanel';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, resolveAccountAccess: vi.fn() };
});

const access = (overrides: Partial<AccountAccess> = {}): AccountAccess => ({
  status: 'HEALTHY',
  message: null,
  customer_roles: ['MSP Customer Manager'],
  internal_roles: [],
  contact_customers: ['ACME'],
  permission_customers: ['ACME'],
  added_contact_links: [],
  added_permissions: [],
  removed_permissions: [],
  ...overrides,
});

const show = (state: AccountAccess) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccessReferencesPanel email="someone@acme.test" access={state} />
    </QueryClientProvider>
  );

beforeEach(() => {
  vi.mocked(internal.resolveAccountAccess).mockResolvedValue({} as never);
});

afterEach(cleanup);

describe('the access references of an account', () => {
  it('says so when both references agree', () => {
    show(access());

    expect(screen.getByText('Access references healthy')).toBeInTheDocument();
    expect(screen.queryByText('Customer access needs review')).not.toBeInTheDocument();
  });

  it('says so when a missing reference was written back', () => {
    show(access({ status: 'REPAIRED_CONTACT_LINK', added_contact_links: ['ACME'] }));

    expect(screen.getByText('Access references repaired')).toBeInTheDocument();
  });

  it('asks for a decision when the two disagree, and never picks one itself', async () => {
    show(
      access({
        status: 'CUSTOMER_REFERENCE_CONFLICT',
        message: 'Customer access references disagree. Review the Contact links and User Permissions before continuing.',
        contact_customers: ['ACME'],
        permission_customers: ['ACME', 'BETA'],
      })
    );

    expect(screen.getByText('Access references need review')).toBeInTheDocument();
    expect(screen.getByText('Customer access needs review')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The Customer references on this account do not agree. Access remains restricted until the references are corrected.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('ACME, BETA')).toBeInTheDocument();
    expect(internal.resolveAccountAccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Use Contact links' }));
    expect(screen.getByText('Reconcile Customer access?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This changes which Customer records this account can access. Review the final Customer list before confirming.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply access references' }));

    await waitFor(() =>
      expect(vi.mocked(internal.resolveAccountAccess).mock.calls[0][0]).toEqual({
        email: 'someone@acme.test',
        source: 'contact',
      })
    );
  });

  it('offers nothing to settle when the roles themselves conflict', () => {
    show(
      access({
        status: 'ROLE_FAMILY_CONFLICT',
        internal_roles: ['MSP Technician'],
        message: 'This account has both customer and Nexgen staff roles. Remove one role family before access can be reconciled.',
      })
    );

    expect(screen.getByText('Access references need review')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This account has both customer and Nexgen staff roles. Remove one role family before access can be reconciled.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use Contact links' })).not.toBeInTheDocument();
  });

  it('shows nothing at all for an account that answers for no customer', () => {
    const { container } = show(access({ status: 'NOT_CUSTOMER_ACCOUNT', customer_roles: [] }));

    expect(container).toBeEmptyDOMElement();
  });
});
