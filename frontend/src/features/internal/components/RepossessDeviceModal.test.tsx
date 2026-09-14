import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import RepossessDeviceModal from './RepossessDeviceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    repossessDevice: vi.fn(),
  };
});

const renderModal = (overrides: Partial<ComponentProps<typeof RepossessDeviceModal>> = {}) => {
  vi.mocked(internal.repossessDevice).mockResolvedValue({
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
      <RepossessDeviceModal
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

describe('RepossessDeviceModal', () => {
  it('shows the hostname, serial number and current holder', () => {
    renderModal();

    expect(screen.getByText('LAPTOP-01')).toBeInTheDocument();
    expect(screen.getByText('SN-123')).toBeInTheDocument();
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
  });

  it('names the destination as available stock', () => {
    renderModal();

    expect(screen.getByText(/available stock/i)).toBeInTheDocument();
  });

  it('states that device services remain unchanged', () => {
    renderModal();

    expect(screen.getByText(/device services will remain unchanged/i)).toBeInTheDocument();
  });
});
