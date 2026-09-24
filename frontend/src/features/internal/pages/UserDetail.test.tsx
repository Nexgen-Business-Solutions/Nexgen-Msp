import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  HeldDevice,
  UserDetail as UserDetailData,
  UserDeviceHolding,
  UserServiceEntry,
  UserServiceTimelineEntry,
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

// one row of the backend's read model: the page shows it as given, and works nothing out
const line = (overrides: Partial<UserServiceTimelineEntry> = {}): UserServiceTimelineEntry => ({
  assignment: 'SA-001',
  name: 'SA-001',
  service_item: 'M365',
  service_name: 'Microsoft 365',
  assignment_scope: 'User',
  device: null,
  hostname: null,
  device_serial_number: null,
  holding_period: null,
  current_holding: true,
  association_from: '2026-01-10',
  association_until: null,
  service_start: '2026-01-10',
  service_end: null,
  operational_status: 'Active',
  billing_status: 'Billable',
  quantity: 1,
  last_billed_on: null,
  source_request: null,
  allowed_actions: ['Change', 'Suspend', 'Remove'],
  pending_request: null,
  ...overrides,
});

const onLaptop = (overrides: Partial<UserServiceTimelineEntry> = {}) =>
  line({
    assignment: 'SA-DEV',
    name: 'SA-DEV',
    service_item: 'SOPHOS',
    service_name: 'Sophos Endpoint',
    assignment_scope: 'Device',
    device: 'DEV-001',
    hostname: 'LAPTOP-JDOE',
    device_serial_number: 'DELL-93821',
    holding_period: 'H2',
    association_from: '2026-09-11',
    service_start: '2026-04-01',
    ...overrides,
  });

const holding = (overrides: Partial<UserDeviceHolding> = {}): UserDeviceHolding => ({
  period: 'H2',
  device: 'DEV-001',
  hostname: 'LAPTOP-JDOE',
  device_type: 'Laptop',
  serial_number: 'DELL-93821',
  device_status: 'Active',
  from_date: '2026-09-11',
  to_date: null,
  is_current: true,
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
  services: [line(), onLaptop()],
  service_counts: { Active: 2 },
  device_history: [
    holding(),
    holding({
      period: 'H1',
      device: 'DEV-OLD',
      hostname: 'LAPTOP-17',
      device_status: 'Stock',
      from_date: '2025-01-12',
      to_date: '2025-06-04',
      is_current: false,
    }),
  ],
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
    past_requests: [
      {
        name: 'SR-0099',
        status: 'Completed',
        priority: 'Medium',
        request_type: 'Add',
        creation: '2025-02-01',
        modified: '2025-02-03',
        lines: [],
        work_total: 0,
        work_done: 0,
      },
    ],
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
    await renderPage(detail({ services: [line({ last_billed_on: '2026-08-31' })] }));

    const row = screen.getByText('Microsoft 365').closest('tr') as HTMLElement;

    expect(within(row).getByText('Last billed 2026-08-31')).toBeInTheDocument();
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

  it('offers transfer and return to stock in the row menu of a machine', async () => {
    await renderPage(detail());

    const row = screen.getAllByText('LAPTOP-JDOE').map((cell) => cell.closest('tr') as HTMLElement).find((tr) => within(tr).queryByText(/DELL-93821/)) as HTMLElement;
    fireEvent.click(within(row).getByTitle('More options'));

    expect(await screen.findByRole('button', { name: /transfer to someone else/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /return to stock/i })).toBeInTheDocument();
  });

  it('opens no request from Nexgen\'s side', async () => {
    await renderPage(detail());

    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/request a (change|suspension|closure)/i)).not.toBeInTheDocument();
  });

  it('still acts on a service a request is about, and says which request', async () => {
    await renderPage(
      detail({ services: [line({ allowed_actions: [], pending_request: 'SR-0125' })] })
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

  it('loads closed requests on demand', async () => {
    await renderPage(detail());

    fireEvent.click(screen.getByRole('button', { name: /load older activity/i }));

    expect(await screen.findByText(/SR-0099/)).toBeInTheDocument();
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

// ------------------------------------------------------------------ every service, any state

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;


describe('the services table carries every service, whatever became of it', () => {
  it('counts every service in the title and sums them up by state', async () => {
    await renderPage(
      detail({
        services: [
          line(),
          onLaptop(),
          line({ assignment: 'SA-S', name: 'SA-S', service_name: 'VPN', operational_status: 'Suspended' }),
          line({ assignment: 'SA-E', name: 'SA-E', service_name: 'Old mailbox', operational_status: 'Ended' }),
        ],
        service_counts: { Active: 2, Suspended: 1, Ended: 1 },
      })
    );

    expect(screen.getByText('Services · 4')).toBeInTheDocument();
    expect(screen.getByText('2 active · 1 suspended · 1 ended')).toBeInTheDocument();
    expect(screen.queryByText(/open$/)).not.toBeInTheDocument();
  });

  it('shows an active personal service as the user\'s own, on no device', async () => {
    await renderPage(detail());

    const row = rowOf('Microsoft 365');

    expect(within(row).getByText('User')).toBeInTheDocument();
    expect(within(row).getByText('2026-01-10')).toBeInTheDocument();
    expect(within(row).getAllByText('—').length).toBe(2);
    expect(within(row).getByText('ACTIVE')).toBeInTheDocument();
  });

  it('keeps an ended personal service in the table, with no lifecycle action', async () => {
    await renderPage(
      detail({
        services: [
          line({
            operational_status: 'Ended',
            billing_status: 'Ended',
            association_until: '2026-08-31',
            service_end: '2026-08-31',
            allowed_actions: [],
          }),
        ],
      })
    );

    const row = rowOf('Microsoft 365');

    expect(within(row).getByText('ENDED')).toBeInTheDocument();
    expect(within(row).getByText('Ended')).toBeInTheDocument();
    expect(within(row).getByText('2026-08-31')).toBeInTheDocument();
    expect(within(row).queryByTitle('More options')).not.toBeInTheDocument();
  });

  it('offers nothing on a cancelled service', async () => {
    await renderPage(detail({ services: [line({ operational_status: 'Cancelled' })] }));

    expect(within(rowOf('Microsoft 365')).queryByTitle('More options')).not.toBeInTheDocument();
  });

  it('offers resume instead of suspend on a suspended service', async () => {
    await renderPage(
      detail({ services: [line({ operational_status: 'Suspended', billing_status: 'On Hold' })] })
    );

    const row = rowOf('Microsoft 365');
    expect(within(row).getByText('SUSPENDED')).toBeInTheDocument();

    fireEvent.click(within(row).getByTitle('More options'));

    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows a device service on the machine they hold, from the day they got it', async () => {
    await renderPage(detail());

    const row = rowOf('Sophos Endpoint');

    expect(within(row).getByText('Device')).toBeInTheDocument();
    expect(within(row).getByText('LAPTOP-JDOE')).toBeInTheDocument();
    expect(within(row).getByText('2026-09-11')).toBeInTheDocument();
    expect(within(row).queryByText('2026-04-01')).not.toBeInTheDocument();
  });

  it('reads a machine they gave back as over for them, while the service still runs', async () => {
    await renderPage(
      detail({
        services: [
          onLaptop({
            hostname: 'LAPTOP-001',
            association_from: '2026-05-01',
            association_until: '2026-09-15',
            current_holding: false,
          }),
        ],
      })
    );

    const row = rowOf('Sophos Endpoint');

    expect(within(row).getByText('2026-05-01')).toBeInTheDocument();
    expect(within(row).getByText('2026-09-15')).toBeInTheDocument();
    expect(within(row).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(row).getByText('Billable')).toBeInTheDocument();
    // acting on it is the next holder's business
    expect(within(row).queryByTitle('More options')).not.toBeInTheDocument();
  });

  it('keeps an ended device service that ran while they held the machine', async () => {
    await renderPage(
      detail({
        services: [
          onLaptop({
            operational_status: 'Ended',
            billing_status: 'Ended',
            association_until: '2026-09-20',
            service_end: '2026-09-20',
          }),
        ],
      })
    );

    const row = rowOf('Sophos Endpoint');

    expect(within(row).getByText('2026-09-20')).toBeInTheDocument();
    expect(within(row).queryByTitle('More options')).not.toBeInTheDocument();
  });

  it('works out no dates of its own: what the backend leaves out is not shown', async () => {
    await renderPage(detail({ services: [line()] }));

    expect(screen.queryByText('Sophos Endpoint')).not.toBeInTheDocument();
  });
});

describe('every machine they have held', () => {
  it('lists current and previous holdings with their dates', async () => {
    await renderPage(detail());

    const panel = screen.getByText('Device history · 2').closest('section') as HTMLElement;
    const current = within(panel).getByText('LAPTOP-JDOE').closest('tr') as HTMLElement;
    const previous = within(panel).getByText('LAPTOP-17').closest('tr') as HTMLElement;

    expect(within(current).getByText('CURRENT')).toBeInTheDocument();
    expect(within(current).getByText('—')).toBeInTheDocument();
    expect(within(previous).getByText('PREVIOUS')).toBeInTheDocument();
    expect(within(previous).getByText('2025-01-12')).toBeInTheDocument();
    expect(within(previous).getByText('2025-06-04')).toBeInTheDocument();
    expect(internal.getUserHistory).not.toHaveBeenCalled();
  });
});
