import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { CustomerUserRef } from '@/lib/api/internal';
import ReinstateDeviceModal from './ReinstateDeviceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    reinstateDevice: vi.fn(),
    listCustomerUsers: vi.fn(),
  };
});

const users: CustomerUserRef[] = [{ name: 'USR-001', full_name: 'Alice Smith', department: null }];

const renderModal = (overrides: Partial<ComponentProps<typeof ReinstateDeviceModal>> = {}) => {
  vi.mocked(internal.listCustomerUsers).mockResolvedValue(users);
  vi.mocked(internal.reinstateDevice).mockResolvedValue({
    name: 'DEV-001',
    hostname: 'LAPTOP-01',
    status: 'Stock',
    assigned_client_user: null,
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ReinstateDeviceModal
        open
        device="DEV-001"
        hostname="LAPTOP-01"
        serialNumber="SN-123"
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

describe('ReinstateDeviceModal', () => {
  it('shows the hostname and serial number', () => {
    renderModal();

    expect(screen.getByText('LAPTOP-01')).toBeInTheDocument();
    expect(screen.getByText('SN-123')).toBeInTheDocument();
  });

  it('returns a device to stock with no client_user when that mode is chosen', async () => {
    renderModal();

    const submitButtons = screen.getAllByRole('button', { name: /return to stock/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(internal.reinstateDevice).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(internal.reinstateDevice).mock.calls[0][0];
    expect(payload.device).toBe('DEV-001');
    expect(payload.client_user).toBeUndefined();
  });

  it('assigns to the chosen person when "Assign immediately to" is picked', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /assign immediately to/i }));
    fireEvent.click(screen.getByRole('button', { name: /choose who takes it/i }));
    fireEvent.click(await screen.findByRole('option', { name: /alice smith/i }));
    fireEvent.click(screen.getByRole('button', { name: /reinstate and assign/i }));

    await waitFor(() => expect(internal.reinstateDevice).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(internal.reinstateDevice).mock.calls[0][0];
    expect(payload.client_user).toBe('USR-001');
  });
});
