import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('states how many open device services will be ended', () => {
    renderModal({ openServiceCount: 3 });

    expect(screen.getByText(/3 open device service\(s\) will be ended/i)).toBeInTheDocument();
  });

  it('says there are no open device services when there are none', () => {
    renderModal({ openServiceCount: 0 });

    expect(screen.getByText(/no open device services/i)).toBeInTheDocument();
  });
});
