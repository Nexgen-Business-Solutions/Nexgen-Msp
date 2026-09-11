import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { DeviceContext, ServiceAvailability } from '@/lib/api/internal';
import DeviceServiceModal from './DeviceServiceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getDeviceContext: vi.fn(),
    deviceServiceAvailability: vi.fn(),
    assignDeviceService: vi.fn(),
  };
});

const context: DeviceContext = {
  device: {
    name: 'DEV-001',
    hostname: 'LAPTOP-JDOE',
    device_type: 'Laptop',
    status: 'Active',
    customer: 'CUST-001',
    assigned_client_user: 'USR-001',
  },
  user_name: 'John Doe',
  // the old unfiltered catalogue: still on the payload, and no longer what the modal offers
  catalogue: [
    { name: 'ITEM-LEGACY', item_name: 'Legacy Catalogue Item', scope: 'Device', already_open: false },
  ],
  customer_requests: [],
};

const availability = (overrides: Partial<ServiceAvailability> = {}): ServiceAvailability => ({
  target: { scope: 'Device', name: 'DEV-001', label: 'LAPTOP-JDOE', customer: 'CUST-001' },
  is_admin: false,
  target_reason: null,
  current: [],
  available: [{ service_item: 'ITEM-SOPHOS', item_name: 'Sophos Endpoint', service_scope: 'Device' }],
  blocked: [],
  ...overrides,
});

const renderModal = async (data: ServiceAvailability = availability()) => {
  vi.mocked(internal.getDeviceContext).mockResolvedValue(context);
  vi.mocked(internal.deviceServiceAvailability).mockResolvedValue(data);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <DeviceServiceModal device="DEV-001" onClose={vi.fn()} />
    </QueryClientProvider>
  );

  await screen.findByText(/LAPTOP-JDOE · held by John Doe/);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeviceServiceModal', () => {
  it('offers what the device availability endpoint says, not the raw device catalogue', async () => {
    await renderModal();

    expect(internal.deviceServiceAvailability).toHaveBeenCalledWith('DEV-001', expect.anything());

    fireEvent.click(await screen.findByRole('button', { name: /select a service/i }));

    expect(await screen.findByRole('option', { name: /sophos endpoint/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /legacy catalogue item/i })).not.toBeInTheDocument();
  });

  it('offers nothing and says why when the machine itself cannot take a service', async () => {
    await renderModal(
      availability({ target_reason: 'LAPTOP-JDOE is retired and cannot take a new service.' })
    );

    expect(
      await screen.findByText('LAPTOP-JDOE is retired and cannot take a new service.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /no device service left to add/i })
    ).toBeInTheDocument();
  });
});
