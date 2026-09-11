import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  ServiceAvailability,
  ServiceAvailabilityCurrent,
  UserDetail as UserDetailData,
  UserDevice,
} from '@/lib/api/internal';
import UserDetail from './UserDetail';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getUser: vi.fn(),
    userServiceAvailability: vi.fn(),
    deviceServiceAvailability: vi.fn(),
    getDeviceContext: vi.fn(),
  };
});

vi.mock('@/lib/api/session', () => ({
  getSessionContext: vi.fn().mockResolvedValue({ user: 'tech@nexgen.test', roles: [] }),
}));

const USER = 'USR-001';

const device = (overrides: Partial<UserDevice> = {}): UserDevice => ({
  name: 'DEV-001',
  hostname: 'LAPTOP-A',
  device_type: 'Laptop',
  status: 'Active',
  serial_number: 'SN-123',
  assigned_date: '2026-06-04',
  retired_date: null,
  assigned_client_user: USER,
  interfaces: [],
  ...overrides,
});

const buildDetail = (devices: UserDevice[] = []): UserDetailData => ({
  user: {
    name: USER,
    full_name: 'John Doe',
    department: 'Accounting',
    customer: 'CUST-001',
    email: 'john@company.com',
    username: 'jdoe',
    lifecycle_status: 'Active',
    start_date: '2024-01-01',
    disabled_date: null,
    portal_user: null,
    remarks: null,
    remark_log: [],
    covered_until: null,
    last_billed_on: null,
    can_delete: false,
    delete_blockers: [],
  },
  devices,
  services: [],
  requests: [],
  customer_requests: [],
  device_types: [],
  interface_types: [],
  catalogue: [],
});

const openService = (
  overrides: Partial<ServiceAvailabilityCurrent> = {}
): ServiceAvailabilityCurrent => ({
  name: 'SA-001',
  service_item: 'ITEM-M365',
  item_name: 'Microsoft 365',
  service_scope: 'User',
  operational_status: 'Active',
  billing_status: 'Billable',
  quantity: 1,
  effective_start_date: '2026-01-10',
  ...overrides,
});

const availability = (
  scope: 'User' | 'Device',
  current: ServiceAvailabilityCurrent[]
): ServiceAvailability => ({
  target: { scope, name: scope === 'User' ? USER : 'DEV-001', label: 'target', customer: 'CUST-001' },
  is_admin: false,
  target_reason: null,
  current,
  available: [],
  blocked: [],
});

const renderPage = async (
  detail: UserDetailData,
  userCurrent: ServiceAvailabilityCurrent[],
  deviceCurrent: Record<string, ServiceAvailabilityCurrent[]> = {}
) => {
  vi.mocked(internal.getUser).mockResolvedValue(detail);
  vi.mocked(internal.userServiceAvailability).mockResolvedValue(availability('User', userCurrent));
  vi.mocked(internal.deviceServiceAvailability).mockImplementation(async (name: string) =>
    availability('Device', deviceCurrent[name] ?? [])
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/msp/users/${USER}`]}>
        <Routes>
          <Route path="/msp/users/:name" element={<UserDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByRole('heading', { name: 'John Doe' });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UserDetail — personal services', () => {
  it('shows an active personal service with Suspend and Close, and no Resume', async () => {
    await renderPage(buildDetail(), [openService()]);

    expect(await screen.findByText('Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('Active since 2026-01-10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^suspend$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resume$/i })).not.toBeInTheDocument();
  });

  it('shows a suspended personal service with Resume and Close, and no Suspend', async () => {
    await renderPage(buildDetail(), [
      openService({
        name: 'SA-002',
        item_name: 'VPN',
        operational_status: 'Suspended',
        billing_status: 'On Hold',
        effective_start_date: '2026-09-01',
      }),
    ]);

    expect(await screen.findByText('VPN')).toBeInTheDocument();
    expect(screen.getByText('Suspended since 2026-09-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
  });

  it('does not fold a device service into the personal list', async () => {
    await renderPage(
      buildDetail([device()]),
      [],
      { 'DEV-001': [openService({ name: 'SA-003', item_name: 'Sophos Endpoint', service_scope: 'Device' })] }
    );

    expect(await screen.findByText('Sophos Endpoint')).toBeInTheDocument();
    expect(screen.getByText('No personal service open for John Doe.')).toBeInTheDocument();
  });
});

describe('UserDetail — device services', () => {
  it('reads the services of a device the person holds today', async () => {
    await renderPage(buildDetail([device()]), [], {
      'DEV-001': [openService({ name: 'SA-003', item_name: 'Sophos Endpoint', service_scope: 'Device' })],
    });

    expect(await screen.findByText('Sophos Endpoint')).toBeInTheDocument();
    expect(internal.deviceServiceAvailability).toHaveBeenCalledWith('DEV-001', expect.anything());
    expect(screen.getByText(/Serial: SN-123 · Active · held since 2026-06-04/)).toBeInTheDocument();
  });

  it('never reads availability for a device the person only held in the past', async () => {
    await renderPage(
      buildDetail([
        device(),
        device({
          name: 'DEV-002',
          hostname: 'LAPTOP-B',
          serial_number: 'SN-456',
          assigned_client_user: 'USR-002',
        }),
      ]),
      []
    );

    await screen.findByText('No service open on this device.');

    expect(internal.deviceServiceAvailability).toHaveBeenCalledWith('DEV-001', expect.anything());
    expect(internal.deviceServiceAvailability).not.toHaveBeenCalledWith(
      'DEV-002',
      expect.anything()
    );
    // the machine still belongs to the history table, it simply gets no live services panel
    expect(screen.getByText('LAPTOP-B')).toBeInTheDocument();
  });
});
