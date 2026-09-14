import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  ExecutionPlan,
  RequestDetail as RequestDetailData,
  SubjectWorkGroup,
  WorkCard,
} from '@/lib/api/internal';
import RequestDetail from './RequestDetail';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getRequest: vi.fn(),
    getRequestExecutionPlan: vi.fn(),
    executeUserSetup: vi.fn(),
    executeDeviceProvisioning: vi.fn(),
    executeServiceAction: vi.fn(),
    verifyWorkItem: vi.fn(),
    changeUserService: vi.fn(),
    userServiceAvailability: vi.fn(),
    completeRequest: vi.fn(),
    setRequestLineStatus: vi.fn(),
    setRequestLineStatuses: vi.fn(),
    executeServiceActions: vi.fn(),
    getTechnicianOptions: vi.fn(),
    addTechnicianAction: vi.fn(),
    runRequestAction: vi.fn(),
    listCustomerDevices: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
    listCustomerRequests: vi.fn(),
    stopAllClientUserServices: vi.fn(),
  };
});

// ------------------------------------------------------------------ fixtures

const request = (overrides: Partial<RequestDetailData> = {}): RequestDetailData =>
  ({
    name: 'SR-0001',
    customer: 'ACME',
    billing_run: null,
    request_type: 'Add',
    status: 'In Progress',
    priority: 'High',
    source: 'Portal',
    requester: 'someone@acme.com',
    requester_name: 'Someone',
    creation: '2026-09-01',
    modified: '2026-09-01',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    lines: [],
    available_actions: [
      { action: 'reject', label: 'Reject', needs_reason: true },
      { action: 'cancel', label: 'Cancel', needs_reason: true },
    ],
    can_decide_lines: false,
    review: null,
    ...overrides,
  }) as unknown as RequestDetailData;

const card = (overrides: Partial<WorkCard>): WorkCard =>
  ({
    name: 'WO-0001',
    plan_key: 'SR-0001:service:x',
    work_type: 'Service Action',
    action: 'Add',
    status: 'Open',
    target_scope: 'User',
    subject_key: 'user:CU-1',
    device_requirement_key: null,
    request_line_name: 'row1',
    request_line_idx: 1,
    client_user: 'CU-1',
    managed_device: null,
    service_item: 'M365',
    service_name: 'Microsoft 365',
    source_service_assignment: null,
    effective_date: '2026-09-15',
    execution_notes: null,
    customer_visible_note: null,
    failure_reason: null,
    completed_by: null,
    completed_at: null,
    resulting_assignment: null,
    resulting_client_user: null,
    resulting_device: null,
    checklist: [],
    ready: true,
    waiting_on: null,
    device: null,
    current: null,
    ...overrides,
  }) as WorkCard;

const group = (overrides: Partial<SubjectWorkGroup> = {}): SubjectWorkGroup => ({
  subject_key: 'user:CU-1',
  person: {
    name: 'CU-1',
    full_name: 'John Doe',
    department: 'Accounting',
    email: 'john@acme.com',
    username: 'j.doe',
    lifecycle_status: 'Active',
    is_new: false,
  },
  user_setup: null,
  devices: [],
  services: [card({})],
  ...overrides,
});

const plan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  request: 'SR-0001',
  customer: 'ACME',
  status: 'In Progress',
  context: {
    customer: 'ACME',
    requester: 'someone@acme.com',
    requester_name: 'Devteam Cam',
    raised_at: '2026-09-13 09:31:00',
    requested_date: '2026-09-15',
    priority: 'High',
    people: 1,
    lines: 1,
    details: 'Please prepare everything before Monday.',
    customer_approved: true,
  },
  recap: [],
  outcome: { accepted: 1, rejected: 0, requested_done: 0, technician_added: 0, technician_done: 0, prepared: 0 },
  stages: {
    current: 'execute',
    stages: [
      { key: 'review', label: 'Review lines', done: true, needed: true, state: 'done' },
      { key: 'execute', label: 'Execute', done: false, needed: true, state: 'current' },
      { key: 'verify', label: 'Verify', done: false, needed: true, state: 'todo' },
      { key: 'complete', label: 'Final validation', done: false, needed: true, state: 'todo' },
    ],
  },
  groups: [group()],
  rejected: [],
  summary: { people: 0, devices: 0, services: 1, open: 1, blocked: 0, failed: 0 },
  activity: [],
  ...overrides,
});

const executed = (overrides: Partial<ExecutionPlan> = {}) =>
  plan({
    stages: {
      current: 'verify',
      stages: [
        { key: 'review', label: 'Review lines', done: true, needed: true, state: 'done' },
        { key: 'execute', label: 'Execute', done: true, needed: true, state: 'done' },
        { key: 'verify', label: 'Verify', done: false, needed: true, state: 'current' },
        { key: 'complete', label: 'Final validation', done: false, needed: true, state: 'todo' },
      ],
    },
    groups: [group({ services: [card({ status: 'Completed', completed_at: '2026-09-13 10:00:00' })] })],
    recap: [
      {
        work_order: 'WO-0001',
        subject_key: 'user:CU-1',
        subject: 'John Doe',
        department: 'Accounting',
        kind: 'requested',
        title: 'Microsoft 365 · Grant a service',
        detail: 'User scope · CU-1',
        reason: null,
        at: '2026-09-13 10:00:00',
        by: 'Tech One',
      },
      {
        work_order: 'WO-0002',
        subject_key: 'user:CU-1',
        subject: 'John Doe',
        department: 'Accounting',
        kind: 'technician',
        title: 'VPN · Grant a service',
        detail: 'User scope · CU-1',
        reason: 'Needed for remote work',
        at: '2026-09-13 10:05:00',
        by: 'Tech One',
      },
    ],
    outcome: { accepted: 1, rejected: 1, requested_done: 1, technician_added: 1, technician_done: 1, prepared: 0 },
    summary: { people: 0, devices: 0, services: 2, open: 0, blocked: 0, failed: 0 },
    ...overrides,
  });

const line = (idx: number, overrides: Record<string, unknown> = {}) => ({
  idx,
  action: 'Add',
  action_label: 'Grant a service',
  action_description: null,
  target_scope: 'User',
  service_scope: 'User',
  is_new_user: 0,
  client_user: `CU-${idx}`,
  client_user_name: `Person ${idx}`,
  client_user_department: 'Commercial',
  new_user_full_name: null,
  new_user_department: null,
  new_user_email: null,
  new_user_username: null,
  is_new_device: 0,
  new_device_label: null,
  new_device_type: null,
  new_device_serial: null,
  managed_device: null,
  device_hostname: null,
  device_type: null,
  device_holder: null,
  requested_service: 'VPN',
  requested_service_name: 'VPN',
  requested_quantity: 1,
  requested_effective_date: '2026-09-15',
  comment: null,
  device_serial: null,
  client_username: null,
  needs_serial: false,
  needs_username: false,
  line_status: 'Pending',
  rejection_reason: null,
  ...overrides,
});

const reviewing = (lines = [line(1), line(2)]) =>
  request({ status: 'Under Review', can_decide_lines: true, lines, details: 'Before Monday.' } as never);

const renderPage = async (detail: RequestDetailData, work?: ExecutionPlan) => {
  vi.mocked(internal.getRequest).mockResolvedValue(detail);
  vi.mocked(internal.getRequestExecutionPlan).mockResolvedValue(work ?? plan());
  vi.mocked(internal.listCustomerRequests).mockResolvedValue([] as never);
  vi.mocked(internal.getDeviceFilterOptions).mockResolvedValue({
    device_types: ['PC', 'Laptop'],
    interface_types: ['Ethernet'],
    statuses: [],
    customers: [],
  } as unknown as Awaited<ReturnType<typeof internal.getDeviceFilterOptions>>);
  vi.mocked(internal.listCustomerDevices).mockResolvedValue([
    {
      name: 'DEV-STOCK',
      hostname: 'LAPTOP-STOCK-14',
      device_type: 'Laptop',
      status: 'Stock',
      serial_number: 'DELL-99881',
      assigned_client_user: null,
      assigned_date: null,
      holder_name: null,
      holder_status: null,
      holder_department: null,
      held_since: null,
      open_services: 0,
      interfaces: [],
    },
    {
      name: 'DEV-HELD',
      hostname: 'LAPTOP-14',
      device_type: 'Laptop',
      status: 'Active',
      serial_number: 'DELL-11111',
      assigned_client_user: 'CU-9',
      assigned_date: null,
      holder_name: 'Peter Holder',
      holder_status: 'Active',
      holder_department: null,
      held_since: null,
      open_services: 0,
      interfaces: [],
    },
  ]);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/requests/SR-0001']}>
        <Routes>
          <Route path="/msp/requests/:name" element={<RequestDetail />} />
          <Route path="/msp/requests" element={<div>Requests listing</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('SR-0001');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the request stays in view at every step', () => {
  it('shows who asked, for when, and the requester note as a message of its own', async () => {
    await renderPage(request(), plan());

    expect(await screen.findByText('Request information')).toBeInTheDocument();
    expect(screen.getAllByText('Devteam Cam').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/requester note/i)).toBeInTheDocument();
    expect(screen.getByText('Please prepare everything before Monday.')).toBeInTheDocument();
  });

  it('walks exactly four steps', async () => {
    await renderPage(request(), plan());
    await screen.findByText('Request information');

    for (const label of ['Review lines', 'Execute', 'Verify', 'Final validation']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText('Prepare')).not.toBeInTheDocument();
  });
});

describe('step 1 — review lines', () => {
  it('executes nothing and asks for a decision on every line', async () => {
    await renderPage(reviewing());

    expect(await screen.findAllByText('Decision required')).toHaveLength(2);
    expect(screen.getByText(/every request line needs a decision/i)).toBeInTheDocument();
    expect(internal.getRequestExecutionPlan).not.toHaveBeenCalled();
  });

  it('offers one decision for lines that plainly share it, written line by line', async () => {
    const detail = reviewing();
    await renderPage(detail);
    vi.mocked(internal.setRequestLineStatuses).mockResolvedValue({
      results: [
        { idx: 1, ok: true, message: null },
        { idx: 2, ok: true, message: null },
      ],
      decided: 2,
      failed: 0,
      request: detail,
    });

    fireEvent.click(await screen.findByRole('button', { name: /accept 2 vpn lines/i }));

    await waitFor(() =>
      expect(internal.setRequestLineStatuses).toHaveBeenCalledWith({
        name: 'SR-0001',
        idxs: [1, 2],
        line_status: 'Approved',
      })
    );
  });

  it('names the lines a group decision did not take', async () => {
    const detail = reviewing();
    await renderPage(detail);
    vi.mocked(internal.setRequestLineStatuses).mockResolvedValue({
      results: [
        { idx: 1, ok: true, message: null },
        { idx: 2, ok: false, message: 'Line 2 not found.' },
      ],
      decided: 1,
      failed: 1,
      request: detail,
    });

    fireEvent.click(await screen.findByRole('button', { name: /accept all pending/i }));

    expect(await screen.findByText(/1 accepted, 1 not/i)).toBeInTheDocument();
    expect(screen.getByText(/line 2 — line 2 not found/i)).toBeInTheDocument();
  });

  it('will not reject a line without a reason', async () => {
    await renderPage(reviewing());

    // the header's own Reject ends the whole request; the line's is the one next to it
    const firstLine = (await screen.findAllByText('VPN · Grant a service'))[0].closest('div.grid') as HTMLElement;
    fireEvent.click(within(firstLine).getByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /reject line/i });

    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Not covered' } });
    vi.mocked(internal.setRequestLineStatus).mockResolvedValue(reviewing());
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(internal.setRequestLineStatus).toHaveBeenCalledWith({
        name: 'SR-0001',
        idx: 1,
        line_status: 'Rejected',
        reason: 'Not covered',
      })
    );
  });

  it('moves on to Execute once every line is decided and one is accepted', async () => {
    const decided = reviewing([line(1, { line_status: 'Approved' }), line(2, { line_status: 'Rejected', rejection_reason: 'No' })]);
    await renderPage(decided);
    vi.mocked(internal.runRequestAction).mockResolvedValue(decided);

    expect(await screen.findByText(/1 accepted · 1 rejected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue to execute/i }));

    await waitFor(() =>
      expect(internal.runRequestAction).toHaveBeenCalledWith({ name: 'SR-0001', action: 'approve' })
    );
  });
});

describe('step 2 — execute', () => {
  it('lets the operator start the work directly without an assignment step', async () => {
    await renderPage(request(), plan());

    expect(screen.queryByRole('button', { name: /take the work/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/assigned technician/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
    // the person's menu only: an Add line has nothing else to choose
    expect(screen.getAllByTitle('More options')).toHaveLength(1);
  });

  it('offers the person the same direct actions as their page', async () => {
    await renderPage(
      request({
        people: {
          'CU-1': {
            name: 'CU-1',
            full_name: 'John Doe',
            department: 'Accounting',
            email: null,
            username: 'j.doe',
            lifecycle_status: 'Active',
            start_date: '2025-01-01',
            disabled_date: null,
            devices: [{ name: 'DEV-1', hostname: 'KV-JDOE', serial_number: 'SN-1', device_type: 'PC', from_date: null }],
            services: [{ name: 'SA-1', service_name: 'Microsoft 365', status: 'Active' }],
            open_requests: [],
          },
        },
      } as never),
      plan()
    );

    fireEvent.click((await screen.findAllByTitle('More options'))[0]);

    for (const label of [
      'Add service',
      'Assign device',
      'Add service on KV-JDOE',
      'Repossess KV-JDOE',
      'Disable user',
      'Stop all services',
    ]) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /^actions$/i })).not.toBeInTheDocument();
  });

  it('lets the technician carry out another act than the one asked on a service line', async () => {
    await renderPage(
      request(),
      plan({
        groups: [
          group({
            services: [
              card({
                action: 'Suspend',
                action_label: 'Suspend',
                source_service_assignment: 'SA-1',
                current: {
                  name: 'SA-1',
                  operational_status: 'Active',
                  quantity: 1,
                  effective_start_date: '2026-01-01',
                  effective_end_date: null,
                },
              }),
            ],
          }),
        ],
      })
    );

    const menus = await screen.findAllByTitle('More options');
    expect(menus).toHaveLength(2);
    fireEvent.click(menus[1]);

    expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^block$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark failed/i })).not.toBeInTheDocument();
  });

  it('asks for the Client User first and creates it from a modal', async () => {
    const owed = plan({
      groups: [
        group({
          person: { name: null, full_name: 'Chloe Mbarga', department: 'Finance', email: 'c@acme.com', username: null, lifecycle_status: null, is_new: true },
          user_setup: card({ name: 'WO-USER', work_type: 'User Setup', action: 'Create User', service_item: null, service_name: null }),
          services: [card({ name: 'WO-SVC', ready: false, waiting_on: 'the person to be created' })],
        }),
      ],
    });
    vi.mocked(internal.executeUserSetup).mockResolvedValue(owed);
    await renderPage(request(), owed);

    expect(await screen.findByText(/client user required/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the person to be created/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create client user/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/no portal account is created/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /create client user/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.executeUserSetup).mock.calls[0][0]).toMatchObject({ work_order: 'WO-USER', email: 'c@acme.com' })
    );
  });

  it('prepares a missing device from stock through a modal', async () => {
    const owed = plan({
      groups: [
        group({
          devices: [
            {
              device_requirement_key: 'new-device:user:CU-1',
              device: null,
              work: card({ name: 'WO-DEV', work_type: 'Device Provisioning', action: 'Assign Device', service_item: null, service_name: null, device_requirement_key: 'new-device:user:CU-1' }),
            },
          ],
          services: [card({ name: 'WO-SOPHOS', target_scope: 'Device', service_name: 'Sophos', device_requirement_key: 'new-device:user:CU-1', ready: false, waiting_on: 'the machine to be prepared' })],
        }),
      ],
    });
    vi.mocked(internal.executeDeviceProvisioning).mockResolvedValue(owed);
    await renderPage(request(), owed);

    expect(await screen.findByText(/device required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /prepare device/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('LAPTOP-STOCK-14'));
    fireEvent.click(within(dialog).getByRole('button', { name: /assign device/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.executeDeviceProvisioning).mock.calls[0][0]).toMatchObject({
        work_order: 'WO-DEV',
        mode: 'existing',
        managed_device: 'DEV-STOCK',
      })
    );
  });

  it('has the machine the customer named from stock already chosen', async () => {
    const owed = plan({
      groups: [
        group({
          devices: [
            {
              device_requirement_key: 'new-device:user:CU-1',
              device: null,
              work: card({
                name: 'WO-DEV',
                work_type: 'Device Provisioning',
                action: 'Assign Device',
                service_item: null,
                service_name: null,
                device_requirement_key: 'new-device:user:CU-1',
                asked_hostname: 'LAPTOP-STOCK-14',
                asked_serial: 'DELL-99881',
              }),
            },
          ],
          services: [card({ name: 'WO-SOPHOS', target_scope: 'Device', service_name: 'Sophos', device_requirement_key: 'new-device:user:CU-1', ready: false, waiting_on: 'the machine to be prepared' })],
        }),
      ],
    });
    vi.mocked(internal.executeDeviceProvisioning).mockResolvedValue(owed);
    await renderPage(request(), owed);

    fireEvent.click(await screen.findByRole('button', { name: /prepare device/i }));
    const dialog = await screen.findByRole('dialog');
    const assign = within(dialog).getByRole('button', { name: /assign device/i });
    await waitFor(() => expect(assign).toBeEnabled());
    fireEvent.click(assign);

    await waitFor(() =>
      expect(vi.mocked(internal.executeDeviceProvisioning).mock.calls[0][0]).toMatchObject({
        work_order: 'WO-DEV',
        mode: 'existing',
        managed_device: 'DEV-STOCK',
      })
    );
  });

  it('names the button after the exact action and runs it', async () => {
    const labelled = plan({ groups: [group({ services: [card({ action_label: 'Grant a service' })] })] });
    vi.mocked(internal.executeServiceAction).mockResolvedValue(labelled);
    await renderPage(request(), labelled);

    expect(screen.queryByRole('button', { name: /apply action/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Grant a service' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Grant a service' }));

    await waitFor(() =>
      expect(vi.mocked(internal.executeServiceAction).mock.calls[0][0]).toMatchObject({ work_order: 'WO-0001' })
    );
  });

  it('runs the same ready action for several people and names the ones that failed', async () => {
    const two = plan({
      groups: [
        group(),
        group({
          subject_key: 'user:CU-2',
          person: { name: 'CU-2', full_name: 'Jane Roe', department: 'Accounting', email: null, username: 'j.roe', lifecycle_status: 'Active', is_new: false },
          services: [card({ name: 'WO-0002', subject_key: 'user:CU-2', client_user: 'CU-2' })],
        }),
      ],
    });
    vi.mocked(internal.executeServiceActions).mockResolvedValue({
      results: [
        { work_order: 'WO-0001', ok: true, message: null },
        { work_order: 'WO-0002', ok: false, message: 'Jane Roe is disabled and cannot be given a new service.' },
      ],
      completed: 1,
      failed: 1,
      plan: two,
    });
    await renderPage(request(), two);

    fireEvent.click(await screen.findByRole('button', { name: /add · microsoft 365 for 2 people/i }));

    await waitFor(() =>
      expect(internal.executeServiceActions).toHaveBeenCalledWith({ work_orders: ['WO-0001', 'WO-0002'] })
    );
    expect(await screen.findByText(/1 completed · 1 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/jane roe is disabled/i)).toBeInTheDocument();
  });

  it('records the act the technician chose, not the one written on the line', async () => {
    const work = plan({
        groups: [
          group({
            services: [
              card({
                action: 'Suspend',
                action_label: 'Suspend',
                source_service_assignment: 'SA-1',
                current: {
                  name: 'SA-1',
                  operational_status: 'Active',
                  quantity: 1,
                  effective_start_date: '2026-01-01',
                  effective_end_date: null,
                },
              }),
            ],
          }),
        ],
      });
    vi.mocked(internal.executeServiceAction).mockResolvedValue(work);
    await renderPage(request(), work);

    fireEvent.click((await screen.findAllByTitle('More options'))[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/it will be recorded as close/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Close', { selector: 'button' }));

    await waitFor(() =>
      expect(vi.mocked(internal.executeServiceAction).mock.calls[0][0]).toMatchObject({
        work_order: 'WO-0001',
        action: 'Remove',
      })
    );
  });
});

describe('step 3 — verify', () => {
  it('is a recap of what was performed, not a checklist', async () => {
    await renderPage(request(), executed());

    expect(await screen.findByText(/what was actually done/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Microsoft 365 · Grant a service')).toBeInTheDocument();
    expect(screen.getByText('Request line')).toBeInTheDocument();
    expect(screen.getByText('Additional action')).toBeInTheDocument();
    expect(screen.getByText('Needed for remote work')).toBeInTheDocument();
  });
});

describe('step 4 — final validation', () => {
  it('sums up the outcome and closes the request', async () => {
    vi.mocked(internal.completeRequest).mockResolvedValue(executed({ status: 'Completed' }));
    await renderPage(request(), executed());

    fireEvent.click(await screen.findByRole('button', { name: /continue to final validation/i }));

    expect(await screen.findByText(/1 accepted request line completed · 1 rejected · 1 additional action completed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /validate & complete request/i }));
    fireEvent.click(screen.getByRole('button', { name: /validate & complete request/i }));

    await waitFor(() => expect(internal.completeRequest).toHaveBeenCalledWith({ name: 'SR-0001' }));
    expect(internal.completeRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Requests listing')).toBeInTheDocument();
  });
});

describe('who each line is for', () => {
  it('shows what is on file about a person: devices, services, other open requests', async () => {
    await renderPage(
      request({
        status: 'Under Review',
        can_decide_lines: true,
        lines: [line(1)],
        people: {
          'CU-1': {
            name: 'CU-1',
            full_name: 'Person 1',
            department: 'Commercial',
            email: 'p1@acme.com',
            username: 'p.one',
            lifecycle_status: 'Active',
            start_date: '2025-01-01',
            disabled_date: null,
            devices: [{ name: 'DEV-1', hostname: 'KV-P1', serial_number: 'SN-1', device_type: 'PC', from_date: null }],
            services: [{ name: 'SA-1', service_name: 'Parallels', status: 'Active' }],
            open_requests: [{ name: 'SR-0099', status: 'Submitted' }],
          },
        },
      } as never)
    );

    expect(await screen.findByText('Username')).toBeInTheDocument();
    expect(screen.getByText('p.one')).toBeInTheDocument();
    expect(screen.getByText('p1@acme.com')).toBeInTheDocument();
    expect(screen.getByText('KV-P1 · SN-1')).toBeInTheDocument();
    expect(screen.getByText('Parallels')).toBeInTheDocument();
    expect(screen.getByText('SR-0099')).toBeInTheDocument();
    expect(screen.queryByText(/account/i)).not.toBeInTheDocument();
  });

  it('shows what the request says about somebody not on file yet', async () => {
    await renderPage(
      request({
        status: 'Under Review',
        can_decide_lines: true,
        lines: [
          line(1, {
            is_new_user: 1,
            client_user: null,
            client_user_name: null,
            new_user_full_name: 'Chloe Mbarga',
            new_user_department: 'Finance',
            new_user_email: 'chloe@acme.com',
          }),
        ],
      } as never)
    );

    expect(await screen.findByText('New person')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('chloe@acme.com')).toBeInTheDocument();
  });
});

describe('what the page must never show', () => {
  it('says nothing about portal accounts', async () => {
    await renderPage(request(), plan());
    await screen.findByText('Request information');

    expect(screen.queryByText(/portal access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite/i)).not.toBeInTheDocument();
  });
});
