import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { DeviceDetail as DeviceDetailData } from '@/lib/api/internal';
import DeviceDetail from './DeviceDetail';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getDevice: vi.fn(),
    deleteDevice: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
    listCustomerUsers: vi.fn(),
  };
});

const buildDetail = (
  status: string,
  overrides: Partial<DeviceDetailData['device']> = {}
): DeviceDetailData => ({
  device: {
    name: 'DEV-001',
    hostname: 'LAPTOP-01',
    device_type: 'Laptop',
    status,
    customer: 'CUST-001',
    assigned_client_user: null,
    user_name: null,
    user_department: null,
    assigned_date: '2024-01-01',
    retired_date: null,
    serial_number: 'SN-123',
    asset_tag: null,
    manufacturer: 'Dell',
    model: 'XPS',
    operating_system: 'Windows 11',
    remarks: null,
    remark_log: [],
    last_billed_on: null,
    covered_until: null,
    can_delete: false,
    delete_blockers: [],
    ...overrides,
  },
  holder_log: [],
  interfaces: [],
  services: [],
  requests: [],
  catalogue: [],
  customer_requests: [],
  device_types: [],
  interface_types: [],
});

const renderDetail = async (detail: DeviceDetailData) => {
  vi.mocked(internal.getDevice).mockResolvedValue(detail);
  vi.mocked(internal.getDeviceFilterOptions).mockResolvedValue({
    device_types: [],
    interface_types: [],
  } as unknown as Awaited<ReturnType<typeof internal.getDeviceFilterOptions>>);
  vi.mocked(internal.listCustomerUsers).mockResolvedValue([]);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/msp/devices/${detail.device.name}`]}>
        <Routes>
          <Route path="/msp/devices/:name" element={<DeviceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText(detail.device.hostname);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('which lifecycle actions a device offers', () => {
  it('offers only Assign to a device sitting in stock', async () => {
    await renderDetail(buildDetail('Stock'));

    expect(screen.getByRole('button', { name: /assign to user/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^transfer$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^return to stock$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reinstate$/i })).not.toBeInTheDocument();
  });

  it('does not offer Retire or Reinstate as primary actions on a pending device', async () => {
    await renderDetail(buildDetail('Pending'));

    expect(screen.getByRole('button', { name: /assign to user/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reinstate$/i })).not.toBeInTheDocument();
  });

  it('offers Transfer and Return to stock to a deployed device, and neither Assign nor Reinstate', async () => {
    await renderDetail(
      buildDetail('Active', { assigned_client_user: 'USR-002', user_name: 'Jane Doe' })
    );

    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^return to stock$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign to user/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reinstate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument();
  });

  it('offers Reinstate but not Retire for a retired device', async () => {
    await renderDetail(buildDetail('Retired'));

    expect(screen.getByRole('button', { name: /^reinstate$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument();
  });

  it('offers both Reinstate and Retire for a damaged device', async () => {
    await renderDetail(buildDetail('Damaged'));

    expect(screen.getByRole('button', { name: /^reinstate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^retire$/i })).toBeInTheDocument();
  });

  it('offers both Reinstate and Retire for a lost device', async () => {
    await renderDetail(buildDetail('Lost'));

    expect(screen.getByRole('button', { name: /^reinstate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^retire$/i })).toBeInTheDocument();
  });
});

describe('who has held it', () => {
  it('shows the latest holder first', async () => {
    await renderDetail({
      ...buildDetail('Active', { assigned_client_user: 'USR-002' }),
      holder_log: [
        {
          client_user: 'USR-001',
          full_name: 'Alice First',
          from_date: '2025-01-01',
          to_date: '2025-06-01',
          note: null,
          is_current: 0,
          idx: 1,
          lifecycle_status: 'Active',
          disabled_date: null,
        },
        {
          client_user: 'USR-002',
          full_name: 'Bob Latest',
          from_date: '2025-06-01',
          to_date: null,
          note: null,
          is_current: 1,
          idx: 2,
          lifecycle_status: 'Active',
          disabled_date: null,
        },
      ],
    });

    const table = screen.getByText('Held by').closest('table') as HTMLElement;
    const holders = within(table)
      .getAllByRole('button')
      .map((button) => button.textContent);

    expect(holders).toEqual(['Bob Latest', 'Alice First']);
  });
});

