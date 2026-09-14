import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { UserFilterOptions } from '@/lib/api/internal';
import NewUserModal from './NewUserModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getUserFilterOptions: vi.fn(),
    createClientUser: vi.fn(),
    listDepartmentOptions: vi.fn(),
  };
});

const filterOptions: UserFilterOptions = {
  customers: ['ACME'],
  departments: ['Somebody typed this once'],
  services: [],
  statuses: [],
  coverage: [],
};

const renderModal = async () => {
  vi.mocked(internal.getUserFilterOptions).mockResolvedValue(filterOptions);
  vi.mocked(internal.listDepartmentOptions).mockResolvedValue([
    { value: 'Accounting', label: 'Accounting' },
    { value: 'Human Resources', label: 'Human Resources' },
  ]);
  vi.mocked(internal.createClientUser).mockResolvedValue({ name: 'CU-999' } as never);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <NewUserModal open onClose={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>
  );

  await screen.findByText('Select a customer');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NewUserModal — department field', () => {
  it('offers exactly the global catalogue, as a picker rather than free text', async () => {
    await renderModal();

    // no plain text box for department any more
    expect(screen.queryByPlaceholderText('Accounting')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /select department/i }));

    expect(await screen.findByRole('option', { name: 'Accounting' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Human Resources' })).toBeInTheDocument();
    // the free-text value that used to sit on a user's record is not a choice on offer
    expect(screen.queryByRole('option', { name: /somebody typed this once/i })).not.toBeInTheDocument();
  });

  it('offers the departments of the chosen customer and sends the picked one', async () => {
    await renderModal();

    fireEvent.click(screen.getByRole('button', { name: /select a customer/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'ACME' }));

    fireEvent.click(await screen.findByRole('button', { name: /select department/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Human Resources' }));

    fireEvent.change(screen.getByPlaceholderText('Marie Dupont'), {
      target: { value: 'Jane Roe' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create and open/i }));

    await waitFor(() =>
      expect(internal.createClientUser).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'ACME', department: 'Human Resources' })
      )
    );
    // asked for that customer: the shared departments plus its own, never another company's
    expect(vi.mocked(internal.listDepartmentOptions).mock.calls.some(([customer]) => customer === 'ACME')).toBe(
      true
    );
  });
});
