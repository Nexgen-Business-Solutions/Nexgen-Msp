import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import RetireDeviceModal from './RetireDeviceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    retireDevice: vi.fn(),
  };
});

const renderModal = (overrides: Partial<ComponentProps<typeof RetireDeviceModal>> = {}) => {
  vi.mocked(internal.retireDevice).mockResolvedValue({
    name: 'DEV-001',
    hostname: 'LAPTOP-01',
    status: 'Retired',
    assigned_client_user: null,
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <RetireDeviceModal
        open
        device="DEV-001"
        hostname="LAPTOP-01"
        serialNumber="SN-123"
        currentHolder="USR-001"
        currentHolderName="Jane Doe"
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

describe('RetireDeviceModal', () => {
  it('shows the hostname, serial number and current holder', () => {
    renderModal();

    expect(screen.getByText('LAPTOP-01')).toBeInTheDocument();
    expect(screen.getByText('SN-123')).toBeInTheDocument();
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
  });

  it('offers to end open services instead of doing it implicitly', async () => {
    renderModal({ openServiceCount: 3 });

    const choice = screen.getByRole('checkbox', { name: /also end this device's open services/i });
    expect(choice).not.toBeChecked();
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole('button', { name: /retire device/i }));

    await waitFor(() =>
      expect(internal.retireDevice).toHaveBeenCalledWith(
        expect.objectContaining({ device: 'DEV-001', end_services: 1 })
      )
    );
  });

  it('says there are no open device services when there are none', () => {
    renderModal({ openServiceCount: 0 });

    expect(screen.getByText(/no open device services/i)).toBeInTheDocument();
  });
});
