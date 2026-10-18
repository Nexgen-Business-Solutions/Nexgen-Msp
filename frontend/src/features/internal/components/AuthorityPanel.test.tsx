import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as internal from '@/lib/api/internal';
import AuthorityPanel from './AuthorityPanel';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getCustomerAuthority: vi.fn(),
    saveCustomerAuthority: vi.fn(),
    getTeamMember: vi.fn(),
    listDepartments: vi.fn(),
  };
});

const approver = (overrides: Record<string, unknown> = {}) => ({
  user: 'marwa.hasno@doliflex.com',
  email: 'marwa.hasno@doliflex.com',
  full_name: 'Marwa Hasno',
  department: null,
  can_submit: true,
  can_approve: true,
  enabled: true,
  role: 'Customer Operator',
  status: 'Active',
  effective_from: null,
  effective_to: null,
  deciding: true,
  ...overrides,
});

const authority = (overrides: Record<string, unknown> = {}) => ({
  customer: 'Kakivu',
  enabled: true,
  approvers: [approver()],
  candidates: [
    { user: 'marwa.hasno@doliflex.com', email: 'marwa.hasno@doliflex.com', full_name: 'Marwa Hasno', enabled: true, last_login: null, role: 'Customer Operator' },
    { user: 'raghib.harb@sonecomx.com', email: 'raghib.harb@sonecomx.com', full_name: 'Ragheb Hareb', enabled: true, last_login: null, role: 'Customer Operator' },
  ],
  gaps: { accounts: 2, nobody_may_raise: false, nobody_may_approve: false },
  ...overrides,
});

const show = (data: ReturnType<typeof authority>) => {
  vi.mocked(internal.getCustomerAuthority).mockResolvedValue(data as never);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthorityPanel customer="Kakivu" />
      </QueryClientProvider>
    </MemoryRouter>
  );
};

beforeEach(() => {
  vi.mocked(internal.saveCustomerAuthority).mockResolvedValue(authority() as never);
  vi.mocked(internal.listDepartments).mockResolvedValue([] as never);
  vi.mocked(internal.getTeamMember).mockResolvedValue({
    name: 'marwa.hasno@doliflex.com',
    user_type: 'Website User',
    enabled: 1,
    creation: '2026-09-01 10:00:00',
    last_login: '2026-10-16 06:04:00',
    last_active: '2026-10-16 06:53:00',
    last_password_reset_date: '2026-09-17',
    two_factor: true,
    abilities: {
      role: 'MSP Customer Operator',
      role_label: 'Customer Operator',
      family: 'customer',
      scope: 'Kakivu',
      groups: [{ title: 'Reach', items: [{ label: 'Read across every customer', allowed: false, detail: null }] }],
    },
  } as never);
});

afterEach(cleanup);

describe('who decides at this customer', () => {
  it('lists them with everything the row has to say', async () => {
    show(authority());

    expect(await screen.findByText('Marwa Hasno')).toBeInTheDocument();
    expect(screen.getByText('marwa.hasno@doliflex.com')).toBeInTheDocument();
    expect(screen.getByText('Decision Maker')).toBeInTheDocument();
    expect(screen.getByText('Whole company')).toBeInTheDocument();
    expect(screen.getByText('Deciding')).toBeInTheDocument();
  });

  it('keeps a line that no longer decides out of the table, and in the record below', async () => {
    show(
      authority({
        approvers: [approver({ status: 'Inactive', deciding: false })],
        gaps: { accounts: 2, nobody_may_raise: true, nobody_may_approve: true },
      })
    );

    expect(await screen.findByText('Nobody decides here at the moment.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit what they decide' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /No longer deciding/ }));

    expect(screen.getByText('Marwa Hasno')).toBeInTheDocument();
    expect(screen.getByText(/Stood down/)).toBeInTheDocument();
  });

  it('puts a line that was stood down back in force without rewriting its rights', async () => {
    show(authority({ approvers: [approver({ status: 'Inactive', deciding: false })] }));

    fireEvent.click(await screen.findByRole('button', { name: /No longer deciding/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Put back in force' }));

    await waitFor(() => {
      const sent = vi.mocked(internal.saveCustomerAuthority).mock.calls[0][0];
      expect(sent.approvers).toHaveLength(1);
      expect(sent.approvers[0].status).toBe('Active');
      expect(sent.approvers[0].effective_to).toBeNull();
      expect(sent.approvers[0].can_approve).toBe(true);
    });
  });

  it('stands a line down from the row menu, keeping it on the matrix', async () => {
    show(authority());

    fireEvent.click((await screen.findAllByRole('button', { name: 'More options' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stand them down' }));

    await waitFor(() => {
      const sent = vi.mocked(internal.saveCustomerAuthority).mock.calls[0][0];
      expect(sent.approvers).toHaveLength(1);
      expect(sent.approvers[0].status).toBe('Inactive');
    });
  });

  it('shows the dates a line is in force for', async () => {
    show(
      authority({
        approvers: [approver({ effective_from: '2026-01-01', effective_to: '2026-12-31' })],
      })
    );

    expect(await screen.findByText('2026-01-01 → 2026-12-31')).toBeInTheDocument();
  });

  it('names a department as the scope when the matrix holds one', async () => {
    show(authority({ approvers: [approver({ department: 'Finance' })] }));

    expect(await screen.findByText('Finance Department')).toBeInTheDocument();
  });

  it('offers to add somebody who is not named yet, and only them', async () => {
    show(authority());

    fireEvent.click(await screen.findByRole('button', { name: /Add Decision-Maker/ }));

    expect(screen.getByText('Add decision-maker')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Choose an account'));
    expect(await screen.findByRole('option', { name: /Ragheb Hareb/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Marwa Hasno/ })).not.toBeInTheDocument();
  });

  it('writes the whole matrix when somebody is named', async () => {
    show(authority());

    fireEvent.click(await screen.findByRole('button', { name: /Add Decision-Maker/ }));
    fireEvent.click(screen.getByText('Choose an account'));
    fireEvent.click(await screen.findByRole('option', { name: /Ragheb Hareb/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const sent = vi.mocked(internal.saveCustomerAuthority).mock.calls[0][0];
      expect(sent.customer).toBe('Kakivu');
      expect(sent.approvers.map((row) => row.user)).toEqual([
        'marwa.hasno@doliflex.com',
        'raghib.harb@sonecomx.com',
      ]);
    });
  });

  it('removes a line without touching the account behind it', async () => {
    show(authority());

    fireEvent.click((await screen.findAllByRole('button', { name: 'More options' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from the matrix' }));
    expect(screen.getByText('Remove this decision-maker?')).toBeInTheDocument();
    expect(screen.getByText(/Their account stays as it is/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(vi.mocked(internal.saveCustomerAuthority).mock.calls[0][0].approvers).toEqual([])
    );
  });
});

describe('reading one of them without leaving the customer', () => {
  it('opens the drawer on the eye, with what they may decide', async () => {
    show(authority());

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));

    const drawer = await screen.findByRole('dialog', { name: /Marwa Hasno details/ });
    expect(drawer).toBeInTheDocument();
    expect(await screen.findByText('Account information')).toBeInTheDocument();
    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });

  it('shows the rights of the account under their own tab', async () => {
    show(authority());

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Access & Rights' }));

    expect(await screen.findByText('Read across every customer')).toBeInTheDocument();
  });

  it('closes again', async () => {
    show(authority());

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    const drawer = await screen.findByRole('dialog', { name: /Marwa Hasno details/ });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Marwa Hasno details/ })).not.toBeInTheDocument()
    );
  });
});
