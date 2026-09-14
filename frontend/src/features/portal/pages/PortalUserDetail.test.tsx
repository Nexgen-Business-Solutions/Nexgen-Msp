import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import type { PortalUserDetail as PortalUserDetailData, PortalUserService } from '@/lib/api/portal';
import PortalUserDetail from './PortalUserDetail';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return { ...actual, getUserDetail: vi.fn() };
});

const service = (overrides: Partial<PortalUserService> = {}): PortalUserService => ({
  name: 'SA-001',
  service_item: 'M365',
  service_name: 'Microsoft 365',
  operational_status: 'Active',
  quantity: 1,
  effective_start_date: '2026-01-10',
  effective_end_date: null,
  source_request: null,
  allowed_actions: ['Change', 'Suspend', 'Remove'],
  pending_request: null,
  ...overrides,
});

const detail = (overrides: Partial<PortalUserDetailData> = {}): PortalUserDetailData => ({
  user: {
    name: 'CU-001',
    full_name: 'John Doe',
    department: 'Accounting',
    customer: 'ACME',
    email: 'john@acme.com',
    username: 'jdoe',
    lifecycle_status: 'Active',
    start_date: '2025-01-10',
    disabled_date: null,
  },
  summary: {
    current_devices: 1,
    active_personal_services: 1,
    active_device_services: 1,
    open_requests: 0,
    attention_count: 0,
  },
  personal_services: { current: [service()], available: [], blocked: [], target_reason: null },
  devices: [
    {
      device: {
        name: 'DEV-001',
        hostname: 'LAPTOP-JDOE',
        device_type: 'Laptop',
        status: 'Active',
        serial_number: 'ABC123',
        in_service_since: '2025-01-05',
      },
      holder_since: '2026-09-11',
      interfaces: [],
      services: {
        current: [service({ name: 'SA-DEV', service_name: 'Sophos' })],
        history: [],
        available: [],
      },
    },
  ],
  open_requests: [],
  attention: [],
  recent_activity: [],
  ...overrides,
});

const renderPage = async (data: PortalUserDetailData) => {
  vi.mocked(portal.getUserDetail).mockResolvedValue(data);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/users/CU-001']}>
        <Routes>
          <Route path="/msp/users/:name" element={<PortalUserDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('John Doe');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the customer reads their own person the same way we do', () => {
  it('keeps their own services apart from what their machine runs', async () => {
    await renderPage(detail());

    const machine = screen.getByText('LAPTOP-JDOE').closest('.rounded-xl') as HTMLElement;

    expect(screen.getByText('Microsoft 365')).toBeInTheDocument();
    expect(within(machine).getByText('Sophos')).toBeInTheDocument();
  });

  it('shows the serial and the day they were given the machine', async () => {
    await renderPage(detail());

    expect(screen.getByText(/Serial ABC123/)).toBeInTheDocument();
    expect(screen.getByText(/Held since 2026-09-11/)).toBeInTheDocument();
  });

  it('keeps the machine service history visible to its new holder', async () => {
    const data = detail();
    data.devices[0].services.history = [
      {
        name: 'SA-OLD',
        service_item: 'LEGACY-AV',
        service_name: 'Legacy antivirus',
        operational_status: 'Ended',
        quantity: 1,
        effective_start_date: '2025-01-10',
        effective_end_date: '2026-01-10',
        source_request: 'REQ-OLD',
      },
    ];

    await renderPage(data);

    const machine = screen.getByText('LAPTOP-JDOE').closest('.rounded-xl') as HTMLElement;
    expect(within(machine).getByText('Service history')).toBeInTheDocument();
    expect(within(machine).getByText('Legacy antivirus')).toBeInTheDocument();
    expect(within(machine).getByText('2025-01-10 to 2026-01-10')).toBeInTheDocument();
  });

  it('offers only to ask, never to administer the asset', async () => {
    await renderPage(detail());

    expect(screen.getAllByRole('button', { name: /request a change/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /manage device/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows nothing internal to us', async () => {
    await renderPage(detail());

    expect(screen.queryByText(/internal note/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/billed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/work order/i)).not.toBeInTheDocument();
  });

  it('says when a change is already under way instead of offering another', async () => {
    await renderPage(
      detail({
        personal_services: {
          current: [service({ pending_request: 'SR-0125' })],
          available: [],
          blocked: [],
          target_reason: null,
        },
      })
    );

    expect(screen.getByText(/already under way · SR-0125/i)).toBeInTheDocument();
  });

  it('says plainly when they hold nothing', async () => {
    await renderPage(detail({ devices: [] }));

    expect(screen.getByText(/currently holds no device/i)).toBeInTheDocument();
  });
});
