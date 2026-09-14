import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { CustomerUserRef } from '@/lib/api/internal';
import AssignDeviceModal from './AssignDeviceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    assignDevice: vi.fn(),
    listCustomerUsers: vi.fn(),
  };
});

const users: CustomerUserRef[] = [
  { name: 'USR-001', full_name: 'Alice Smith', department: 'Sales' },
  { name: 'USR-002', full_name: 'Bob Jones', department: null },
];

const renderModal = (overrides: Partial<ComponentProps<typeof AssignDeviceModal>> = {}) => {
  vi.mocked(internal.listCustomerUsers).mockResolvedValue(users);
  vi.mocked(internal.assignDevice).mockResolvedValue({
    name: 'DEV-001',
    hostname: 'LAPTOP-01',
    status: 'Active',
    assigned_client_user: 'USR-001',
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <AssignDeviceModal
        open
        device="DEV-001"
        hostname="LAPTOP-01"
        serialNumber="SN-123"
        status="Stock"
        customer="CUST-001"
        onClose={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AssignDeviceModal', () => {
  it('shows the hostname and serial number', () => {
    renderModal();

    expect(screen.getByText('LAPTOP-01')).toBeInTheDocument();
    expect(screen.getByText(/SN-123/)).toBeInTheDocument();
  });

  it('offers a former holder normally, unexcluded, alongside every other customer user', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /choose who takes it/i }));

    expect(await screen.findByRole('option', { name: /alice smith/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /bob jones/i })).toBeInTheDocument();
  });
});
