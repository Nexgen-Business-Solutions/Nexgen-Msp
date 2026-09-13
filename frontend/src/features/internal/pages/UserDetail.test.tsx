import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    disableClientUser: vi.fn(),
    reactivateClientUser: vi.fn(),
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

  it('says nothing about signing in: a person here is not an account', async () => {
    await renderPage(detail());

    expect(screen.queryByText(/portal access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/portal account/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grant access|invite/i })).not.toBeInTheDocument();
  });
});

describe('what is theirs and what the machine carries', () => {
  it('reads a personal service in its own section', async () => {
    await renderPage(detail());

    expect(screen.getByText('Microsoft 365')).toBeInTheDocument();
  });

  it('lists a device service in the same table, with the machine that runs it', async () => {
    await renderPage(detail());

    const row = screen.getByText('Sophos Endpoint').closest('tr') as HTMLElement;

    expect(within(row).getByText('LAPTOP-JDOE')).toBeInTheDocument();
  });

  it('lists the machines they hold as a table, with serial and holding date', async () => {
    await renderPage(detail());

    const row = screen.getAllByText('LAPTOP-JDOE').map((cell) => cell.closest('tr') as HTMLElement).find((tr) => within(tr).queryByText(/DELL-93821/));

    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('2026-09-11')).toBeInTheDocument();
  });

  it('says plainly when they hold nothing, and offers no request', async () => {
    await renderPage(
      detail({ devices: [], summary: { ...detail().summary, current_devices: 0 } })
    );

    expect(screen.getByText(/currently holds no device/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request a device/i })).not.toBeInTheDocument();
  });

  it('shows when each service was last billed rather than its quantity', async () => {
    await renderPage(detail());

    expect(screen.getByText('Last billed')).toBeInTheDocument();
    expect(screen.queryByText('Quantity')).not.toBeInTheDocument();
  });
});

describe('Nexgen acts directly from here', () => {
  it('adds a service directly', async () => {
    await renderPage(detail());

    expect(screen.getAllByRole('button', { name: /add service/i }).length).toBeGreaterThan(0);
  });

  it('assigns a device directly', async () => {
    await renderPage(detail());

    expect(screen.getByRole('button', { name: /assign a device/i })).toBeInTheDocument();
  });

  it('offers suspend, change and close in the row menu of a running service', async () => {
    await renderPage(detail());

    const row = screen.getByText('Microsoft 365').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTitle('More options'));

    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('offers transfer and repossess in the row menu of a machine', async () => {
    await renderPage(detail());

    const row = screen.getAllByText('LAPTOP-JDOE').map((cell) => cell.closest('tr') as HTMLElement).find((tr) => within(tr).queryByText(/DELL-93821/)) as HTMLElement;
    fireEvent.click(within(row).getByTitle('More options'));

    expect(await screen.findByRole('button', { name: /transfer to someone else/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /repossess/i })).toBeInTheDocument();
  });

  it('opens no request from Nexgen\'s side', async () => {
    await renderPage(detail());

    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/request a (change|suspension|closure)/i)).not.toBeInTheDocument();
  });

  it('still acts on a service a request is about, and says which request', async () => {
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

    const row = screen.getByText(/in request SR-0125/i).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTitle('More options'));

    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
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

describe('somebody leaving, and coming back', () => {
  it('disables them while keeping service closure an explicit choice', async () => {
    const data = detail();
    await renderPage(data);
    vi.mocked(internal.disableClientUser).mockResolvedValue(data);

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/also end their open services/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/services will stay open/i)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /disable user/i }));

    await waitFor(() =>
      expect(internal.disableClientUser).toHaveBeenCalledWith({
        name: data.user.name,
        effective_date: '2026-09-01',
        reason: 'Departure',
        end_services: 0,
      })
    );
  });

  it('offers to reactivate somebody who has left, instead of disabling them again', async () => {
    const data = detail();
    const gone = {
      ...data,
      user: { ...data.user, lifecycle_status: 'Disabled', disabled_date: '2026-09-01', disabled_reason: 'Departure' },
    };
    await renderPage(gone);
    vi.mocked(internal.reactivateClientUser).mockResolvedValue(data);

    expect(screen.queryByRole('button', { name: /^disable$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/\(Departure\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^reactivate$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^reactivate$/i }));

    await waitFor(() => expect(internal.reactivateClientUser).toHaveBeenCalledWith(data.user.name));
  });
});
