import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  HeldDevice,
  UserDetail as UserDetailData,
  UserServiceEntry,
} from '@/lib/api/internal';
import UserDetail from './UserDetail';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getUser: vi.fn(),
    getUserHistory: vi.fn(),
    listCustomerRequests: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
    getSession: vi.fn(),
  };
});

// ------------------------------------------------------------------ fixtures

const service = (overrides: Partial<UserServiceEntry> = {}): UserServiceEntry => ({
  name: 'SA-001',
  service_item: 'M365',
  service_name: 'Microsoft 365',
  operational_status: 'Active',
  billing_status: 'Billable',
  quantity: 1,
  effective_start_date: '2026-01-10',
  effective_end_date: null,
  source_request: null,
  allowed_actions: ['Change', 'Suspend', 'Remove'],
  pending_request: null,
  ...overrides,
});

const held = (overrides: Partial<HeldDevice> = {}): HeldDevice => ({
  device: {
    name: 'DEV-001',
    hostname: 'LAPTOP-JDOE',
    device_type: 'Laptop',
    status: 'Active',
    serial_number: 'DELL-93821',
    in_service_since: '2025-01-05',
  },
  holder_since: '2026-09-11',
  interfaces: [{ interface_type: 'Wi-Fi', mac_address: '00:11:22:33:44:55' }],
  services: {
    current: [service({ name: 'SA-DEV', service_name: 'Sophos Endpoint' })],
    available: [{ service_item: 'RMM', item_name: 'RMM', service_scope: 'Device' }],
  },
  ...overrides,
});

const detail = (overrides: Partial<UserDetailData> = {}): UserDetailData => ({
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
    portal_access: true,
  },
  summary: {
    current_devices: 1,
    active_personal_services: 1,
    active_device_services: 1,
    open_requests: 0,
    attention_count: 0,
  },
  personal_services: {
    current: [service()],
    available: [{ service_item: 'VPN', item_name: 'VPN', service_scope: 'User' }],
    blocked: [],
    target_reason: null,
  },
  devices: [held()],
  open_requests: [],
  attention: [],
  recent_activity: [
    { on: '2026-09-11', kind: 'device', entity: 'DEV-001', what: 'LAPTOP-JDOE handed over' },
  ],
  can_delete: false,
  delete_blockers: ['1 open service'],
  billing: { covered_until: '2026-08-31', last_billed_on: '2026-09-01' },
  notes: { latest: null, count: 0, log: [] },
  ...overrides,
});

const renderPage = async (data: UserDetailData) => {
  vi.mocked(internal.getUser).mockResolvedValue(data);
  vi.mocked(internal.listCustomerRequests).mockResolvedValue([]);
  vi.mocked(internal.getDeviceFilterOptions).mockResolvedValue({
    customers: [],
    device_types: ['Laptop'],
    statuses: [],
    coverage: [],
    interface_types: ['Wi-Fi', 'LAN'],
  });
  vi.mocked(internal.getUserHistory).mockResolvedValue({
    past_devices: [
      {
        period: 'H1',
        name: 'DEV-OLD',
        hostname: 'LAPTOP-17',
        device_type: 'Laptop',
        serial_number: 'OLD-1',
        status: 'Stock',
        held_from: '2025-01-12',
        held_until: '2025-06-04',
      },
    ],
    past_personal_services: [],
    past_requests: [],
    activity: [],
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/users/CU-001']}>
        <Routes>
          <Route path="/msp/users/:name" element={<UserDetail />} />
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

// ------------------------------------------------------------------ the reading

describe('the page says who this is before anything else', () => {
  it('leads with the name, the department and the state', async () => {
    await renderPage(detail());

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText(/jdoe/)).toBeInTheDocument();
  });

  it('counts what is theirs and what their machines carry separately', async () => {
    await renderPage(detail());

    const header = screen.getByText('John Doe').closest('section') as HTMLElement;

    expect(within(header).getByText(/personal services/i)).toBeInTheDocument();
    expect(within(header).getByText(/device services/i)).toBeInTheDocument();
  });

  it('keeps the money out of the identity card', async () => {
    await renderPage(detail());

    const header = screen.getByText('John Doe').closest('section') as HTMLElement;

    expect(within(header).queryByText(/billed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/billing & coverage/i)).toBeInTheDocument();
  });
});

describe('what is theirs and what the machine carries', () => {
  it('reads a personal service in its own section', async () => {
    await renderPage(detail());

    expect(screen.getByText('Microsoft 365')).toBeInTheDocument();
  });

  it('reads a device service inside the machine that runs it', async () => {
    await renderPage(detail());

    const card = screen.getByText('LAPTOP-JDOE').closest('section') as HTMLElement;

    expect(within(card).getByText('Sophos Endpoint')).toBeInTheDocument();
    expect(within(card).getByText(/DELL-93821/)).toBeInTheDocument();
    expect(within(card).getByText(/Held since 2026-09-11/)).toBeInTheDocument();
  });

  it('offers what is still available on that one machine, inside it', async () => {
    await renderPage(detail());

    const card = screen.getByText('LAPTOP-JDOE').closest('section') as HTMLElement;

    expect(within(card).getByRole('button', { name: /RMM/ })).toBeInTheDocument();
  });

  it('says plainly when they hold nothing', async () => {
    await renderPage(
      detail({ devices: [], summary: { ...detail().summary, current_devices: 0 } })
    );

    expect(screen.getByText(/currently holds no device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request a device/i })).toBeInTheDocument();
  });
});

describe('the actions this page has always offered are still here', () => {
  it('adds a service directly', async () => {
    await renderPage(detail());

    expect(screen.getAllByRole('button', { name: /add service/i }).length).toBeGreaterThan(0);
  });

  it('assigns a device directly', async () => {
    await renderPage(detail());

    expect(screen.getByRole('button', { name: /assign a device/i })).toBeInTheDocument();
  });

  it('suspends and closes a running service from the row', async () => {
    await renderPage(detail());

    expect(screen.getAllByRole('button', { name: /^suspend$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^close$/i }).length).toBeGreaterThan(0);
  });

  it('starts a request for the person too', async () => {
    await renderPage(detail());

    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  it('offers nothing on a service somebody is already changing', async () => {
    await renderPage(
      detail({
        personal_services: {
          current: [service({ allowed_actions: [], pending_request: 'SR-0125' })],
          available: [],
          blocked: [],
          target_reason: null,
        },
      })
    );

    const row = screen
      .getByText(/change in progress · SR-0125/i)
      .closest('div')?.parentElement as HTMLElement;

    expect(within(row).queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument();
  });
});

describe('what needs looking at, and what is being done', () => {
  it('shows the backend’s own words and nothing invented here', async () => {
    await renderPage(
      detail({
        attention: [
          {
            code: 'DEVICE_SERIAL_MISSING',
            severity: 'warning',
            entity_type: 'Device',
            entity: 'DEV-001',
            message: 'LAPTOP-JDOE has no serial number.',
          },
        ],
      })
    );

    expect(screen.getByText('LAPTOP-JDOE has no serial number.')).toBeInTheDocument();
  });

  it('says nothing at all when there is nothing wrong', async () => {
    await renderPage(detail());

    expect(screen.queryByText(/^attention$/i)).not.toBeInTheDocument();
  });

  it('puts open requests above the past', async () => {
    await renderPage(
      detail({
        open_requests: [
          {
            name: 'SR-0125',
            status: 'In Progress',
            priority: 'High',
            request_type: 'Add',
            creation: '2026-09-01',
            modified: '2026-09-02',
            lines: [
              { idx: 1, action: 'Add', service_name: 'Microsoft 365', line_status: 'Approved', hostname: null },
            ],
            work_total: 5,
            work_done: 3,
            technician: 'Peter',
          },
        ],
      })
    );

    const requests = screen.getByText('Open requests');
    const history = screen.getByText('Recent activity');

    expect(requests.compareDocumentPosition(history)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/3 of 5 work items done/i)).toBeInTheDocument();
  });
});

describe('the past is asked for, not carried', () => {
  it('does not fetch the history until somebody opens it', async () => {
    await renderPage(detail());

    expect(internal.getUserHistory).not.toHaveBeenCalled();
  });

  it('loads past devices on demand', async () => {
    await renderPage(detail());

    fireEvent.click(screen.getByRole('button', { name: /load older activity/i }));

    expect(await screen.findByText(/LAPTOP-17/)).toBeInTheDocument();
  });
});
