import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as internal from '@/lib/api/internal';
import DecisionMakerModal from './DecisionMakerModal';
import type { Approver } from '@/lib/api/internal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    saveCustomerAuthority: vi.fn(),
    listDepartments: vi.fn(),
  };
});

const named: Approver = {
  user: 'marwa.hasno@doliflex.com',
  full_name: 'Marwa Hasno',
  department: null,
  can_submit: true,
  can_approve: true,
  status: 'Active',
  effective_from: null,
  effective_to: '2026-12-31',
  deciding: true,
};

const show = (editing: Approver | null = null) =>
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DecisionMakerModal
          open
          customer="Kakivu"
          enabled
          approvers={[named]}
          candidates={[
            {
              user: 'raghib.harb@sonecomx.com',
              email: 'raghib.harb@sonecomx.com',
              full_name: 'Ragheb Hareb',
              enabled: true,
              last_login: null,
              role: 'Customer Operator',
            },
          ]}
          editing={editing}
          onClose={() => {}}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.mocked(internal.saveCustomerAuthority).mockResolvedValue({} as never);
  vi.mocked(internal.listDepartments).mockResolvedValue([] as never);
});

afterEach(cleanup);

describe('naming a decision-maker', () => {
  it('offers only the accounts of this customer that are not named yet', async () => {
    show();

    fireEvent.click(screen.getByText('Choose an account'));

    expect(await screen.findByRole('option', { name: /Ragheb Hareb/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Marwa Hasno/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Accounts are opened on the accounts screen/)).toBeInTheDocument();
  });

  it('writes the chosen account into the matrix', async () => {
    show();

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

  it('refuses to save until an account is chosen', () => {
    show();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('offers no way to open an account from here', () => {
    show();

    expect(screen.queryByRole('button', { name: 'New decision-maker' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('shows the life of the relationship when an existing line is being changed', () => {
    show(named);

    expect(screen.getByText('The relationship itself')).toBeInTheDocument();
  });

  it('carries the standing and the dates of the line it edits', async () => {
    show(named);

    expect(screen.getByLabelText('Until')).toHaveValue('2026-12-31');
    fireEvent.click(screen.getByLabelText('Stood down'));
    fireEvent.change(screen.getByLabelText('Decides from'), { target: { value: '2026-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const sent = vi.mocked(internal.saveCustomerAuthority).mock.calls[0][0];
      expect(sent.approvers).toHaveLength(1);
      expect(sent.approvers[0].status).toBe('Inactive');
      expect(sent.approvers[0].effective_from).toBe('2026-02-01');
      expect(sent.approvers[0].effective_to).toBe('2026-12-31');
    });
  });
});
