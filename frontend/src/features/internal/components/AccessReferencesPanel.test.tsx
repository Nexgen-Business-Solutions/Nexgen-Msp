import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { AccountAbilities, AccountAccess } from '@/lib/api/internal';
import AccessReferencesPanel from './AccessReferencesPanel';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, resolveAccountAccess: vi.fn(), getTeamOptions: vi.fn() };
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

const abilities = (overrides: Partial<AccountAbilities> = {}): AccountAbilities => ({
  role: 'MSP Customer Manager',
  role_label: 'Customer Manager',
  family: 'customer',
  scope: 'ACME',
  groups: [
    {
      title: 'Reach',
      items: [
        { label: 'Read across every customer', allowed: false, detail: null },
        {
          label: "Read this company's people, machines, services and requests",
          allowed: true,
          detail: null,
        },
      ],
    },
    {
      title: 'Requests',
      items: [
        {
          label: 'Raise requests from the portal',
          allowed: true,
          detail: 'Named on the authority matrix',
        },
        {
          label: "Approve this company's requests",
          allowed: true,
          detail: 'For the Finance Department only',
        },
      ],
    },
  ],
  ...overrides,
});

const show = (state: AccountAccess, rights: AccountAbilities = abilities()) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AccessReferencesPanel email="someone@acme.test" access={state} abilities={rights} />
    </QueryClientProvider>
  );

const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Show access and rights' }));

beforeEach(() => {
  vi.mocked(internal.resolveAccountAccess).mockResolvedValue({} as never);
  vi.mocked(internal.getTeamOptions).mockResolvedValue({
    internal_roles: [],
    customer_roles: [],
    customers: ['ACME', 'BETA', 'GAMMA'],
  } as never);
});

afterEach(cleanup);

describe('the access references of an account', () => {
  it('says so when both references agree', () => {
    show(access());

    expect(screen.getByText('Access and rights')).toBeInTheDocument();
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer access needs review')).not.toBeInTheDocument();
  });

  it('says so when a missing reference was written back', () => {
    show(access({ status: 'REPAIRED_CONTACT_LINK', added_contact_links: ['ACME'] }));

    expect(screen.getByText('References repaired')).toBeInTheDocument();
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

    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Customer access needs review')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The Customer references on this account do not agree. Access remains restricted until the references are corrected.'
      )
    ).toBeInTheDocument();
    expect(internal.resolveAccountAccess).not.toHaveBeenCalled();

    expand();
    expect(screen.getByText('ACME, BETA')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use the Contact link' }));
    expect(screen.getByText('Reconcile Customer access?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This account answers for one company. It will see that company and no other.'
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

    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This account has both customer and Nexgen staff roles. Remove one role family before access can be reconciled.'
      )
    ).toBeInTheDocument();

    expand();
    expect(screen.queryByRole('button', { name: 'Use the Contact link' })).not.toBeInTheDocument();
  });
});

describe('what the account may do', () => {
  it('stays folded away until it is asked for', () => {
    show(access());

    expect(screen.queryByText('Reach')).not.toBeInTheDocument();
    expect(screen.queryByText('Companies this account acts for')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show access and rights' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('summarises the role and how many rights it holds without being opened', () => {
    show(access());

    expect(screen.getByText(/Customer Manager · acts for ACME · 3 of 4 rights/)).toBeInTheDocument();
  });

  it('lists every right once opened, kept apart and refused ones shown as refused', () => {
    show(access());
    expand();

    expect(screen.getByText('What a Customer Manager can do here')).toBeInTheDocument();
    expect(screen.getByText('Reach')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('For the Finance Department only')).toBeInTheDocument();

    const refused = screen.getByText('Read across every customer');
    expect(refused).toBeInTheDocument();
    expect(refused.className).toContain('text-slate-400');
    expect(screen.getByText('Raise requests from the portal').className).toContain('text-slate-800');
  });

  it('folds back when the heading is clicked again', () => {
    show(access());
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Hide access and rights' }));
    expect(screen.queryByText('Reach')).not.toBeInTheDocument();
  });

  it('answers for an account that is not a customer one, which has no references to show', () => {
    show(
      access({ status: 'NOT_CUSTOMER_ACCOUNT', customer_roles: [], internal_roles: ['MSP Technician'] }),
      abilities({
        role: 'MSP Technician',
        role_label: 'Technician',
        family: 'internal',
        scope: 'Every customer we serve',
        groups: [
          {
            title: 'Requests',
            items: [{ label: 'Carry requests out', allowed: true, detail: null }],
          },
        ],
      })
    );

    expect(screen.getByText('Access and rights')).toBeInTheDocument();

    expand();
    expect(screen.getByText('What a Technician can do here')).toBeInTheDocument();
    expect(screen.getByText('Carry requests out')).toBeInTheDocument();
    expect(screen.queryByText('Contact link')).not.toBeInTheDocument();
    expect(screen.queryByText('User Permission')).not.toBeInTheDocument();
  });

  it('names the role with the article its own name asks for', () => {
    show(access(), abilities({ role: 'MSP System Admin', role_label: 'Administrator' }));
    expand();

    expect(screen.getByText('What an Administrator can do here')).toBeInTheDocument();
  });

  it('still names the panel for an account carrying no role at all', () => {
    show(access(), abilities({ role: null, role_label: null, family: null }));

    expect(screen.getByText(/No role · acts for ACME · 3 of 4 rights/)).toBeInTheDocument();
    expand();
    expect(screen.getByText('What this account can do here')).toBeInTheDocument();
  });
});

describe('settling which company the account answers for', () => {
  const conflict = () =>
    access({
      status: 'CUSTOMER_REFERENCE_CONFLICT',
      message: 'Customer access references disagree.',
      contact_customers: ['ACME'],
      permission_customers: ['BETA'],
    });

  it('offers one company to pick from a searchable list, never a typed-in line', async () => {
    show(conflict());
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Choose the company' }));

    expect(screen.queryByPlaceholderText('Customer A, Customer B')).not.toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    // the company already on the Contact is the one offered first
    expect(screen.getByTitle('ACME')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('ACME'));
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /GAMMA/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /GAMMA/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply access references' }));

    await waitFor(() =>
      expect(vi.mocked(internal.resolveAccountAccess).mock.calls[0][0]).toEqual({
        email: 'someone@acme.test',
        customers: ['GAMMA'],
      })
    );
  });

  it('sends exactly one company, never a list', async () => {
    show(conflict());
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Choose the company' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply access references' }));

    await waitFor(() =>
      expect(vi.mocked(internal.resolveAccountAccess).mock.calls[0][0]).toEqual({
        email: 'someone@acme.test',
        customers: ['ACME'],
      })
    );
  });

  it('speaks of one company, not of several', () => {
    show(conflict());
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Use the Contact link' }));

    expect(
      screen.getByText('This account answers for one company. It will see that company and no other.')
    ).toBeInTheDocument();
  });
});
