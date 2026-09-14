import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { CustomerUserRef } from '@/lib/api/internal';
import TransferDeviceModal from './TransferDeviceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    transferDevice: vi.fn(),
    listCustomerUsers: vi.fn(),
  };
});

const users: CustomerUserRef[] = [
  { name: 'USR-001', full_name: 'Jane Doe', department: 'Support' },
  { name: 'USR-002', full_name: 'Mark Twain', department: null },
];

const renderModal = (overrides: Partial<ComponentProps<typeof TransferDeviceModal>> = {}) => {
  vi.mocked(internal.listCustomerUsers).mockResolvedValue(users);
  vi.mocked(internal.transferDevice).mockResolvedValue({
    name: 'DEV-001',
    hostname: 'LAPTOP-01',
    status: 'Active',
    assigned_client_user: 'USR-002',
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <TransferDeviceModal
        open
        device="DEV-001"
        hostname="LAPTOP-01"
        serialNumber="SN-123"
        customer="CUST-001"
        currentHolder="USR-001"
        currentHolderName="Jane Doe"
        heldSince="2024-01-01"
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

describe('TransferDeviceModal', () => {
  it('shows the hostname, serial number and current holder', () => {
    renderModal();

    expect(screen.getByText('LAPTOP-01')).toBeInTheDocument();
    expect(screen.getByText('SN-123')).toBeInTheDocument();
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
  });

  it('excludes the current holder from the offered choices, but keeps everyone else', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /choose who takes it/i }));

    expect(await screen.findByRole('option', { name: /mark twain/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /jane doe/i })).not.toBeInTheDocument();
  });
});
