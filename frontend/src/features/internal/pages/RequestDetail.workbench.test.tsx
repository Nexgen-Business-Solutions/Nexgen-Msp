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
    blockWorkItem: vi.fn(),
    resumeWorkItem: vi.fn(),
    completeRequest: vi.fn(),
    assignRequestTechnician: vi.fn(),
    setRequestLineStatus: vi.fn(),
    runRequestAction: vi.fn(),
    listCustomerDevices: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
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
    assigned_technician: null,
    assigned_technician_name: null,
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
  stages: {
    current: 'execute',
    stages: [
      { key: 'review', label: 'Review', done: true, needed: true, state: 'done' },
      { key: 'prepare', label: 'Prepare', done: true, needed: false, state: 'skipped' },
      { key: 'execute', label: 'Execute', done: false, needed: true, state: 'current' },
      { key: 'verify', label: 'Verify', done: false, needed: true, state: 'todo' },
      { key: 'complete', label: 'Complete', done: false, needed: true, state: 'todo' },
    ],
  },
  groups: [group()],
  rejected: [],
  summary: { people: 0, devices: 0, services: 1, open: 1, blocked: 0, failed: 0 },
  activity: [],
  ...overrides,
});

const renderPage = async (detail: RequestDetailData, work?: ExecutionPlan) => {
  vi.mocked(internal.getRequest).mockResolvedValue(detail);
  vi.mocked(internal.getRequestExecutionPlan).mockResolvedValue(work ?? plan());
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

// ------------------------------------------------------------------ the rule

describe('the request is the whole of the workbench', () => {
  it('sends the technician nowhere else', async () => {
    await renderPage(request());

    expect(screen.queryByText(/open profile/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/work order/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /device/i })).not.toBeInTheDocument();
  });

  it('shows the five phases of the job with the ones nobody needs passed over', async () => {
    await renderPage(request());

    expect(screen.getByText('Execute')).toBeInTheDocument();
    expect(screen.getByText(/not needed/i)).toBeInTheDocument();
  });

  it('never shows a service without saying who and what it is for', async () => {
    await renderPage(request());

    const service = screen.getByText(/Add · Microsoft 365/).closest('div') as HTMLElement;

    expect(within(service).getByText(/John Doe/)).toBeInTheDocument();
  });
});

describe('the review happens in the review stage', () => {
  const underReview = request({
    status: 'Under Review',
    can_decide_lines: true,
    lines: [
      {
        idx: 1,
        action: 'Add',
        action_label: 'Add',
        target_scope: 'User',
        client_user: 'CU-1',
        client_user_name: 'John Doe',
        requested_service: 'M365',
        requested_service_name: 'Microsoft 365',
        line_status: 'Pending',
        is_new_user: 0,
        is_new_device: 0,
      },
    ] as unknown as RequestDetailData['lines'],
  });

  it('decides a line without leaving the page', async () => {
    vi.mocked(internal.setRequestLineStatus).mockResolvedValue(underReview);
    await renderPage(underReview);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(internal.setRequestLineStatus).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.setRequestLineStatus).mock.calls[0][0]).toMatchObject({
      idx: 1,
      line_status: 'Approved',
    });
  });

  it('offers to approve the request only once every line is decided', async () => {
    const decided = request({
      ...underReview,
      lines: [{ ...underReview.lines[0], line_status: 'Approved' }],
    });
    vi.mocked(internal.runRequestAction).mockResolvedValue(decided);
    await renderPage(decided);

    fireEvent.click(screen.getByRole('button', { name: /approve request and prepare work/i }));

    await waitFor(() => expect(internal.runRequestAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.runRequestAction).mock.calls[0][0]).toMatchObject({
      action: 'approve',
    });
  });

  it('keeps start review and mark completed out of the header', async () => {
    await renderPage(underReview);

    expect(screen.queryByRole('button', { name: /start review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start work/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^mark completed$/i })).not.toBeInTheDocument();
  });
});

describe('preparing the person and the machine, in the request', () => {
  it('creates the user from the card itself', async () => {
    vi.mocked(internal.executeUserSetup).mockResolvedValue(plan());
    await renderPage(
      request(),
      plan({
        groups: [
          group({
            person: {
              name: null,
              full_name: 'Marie Dupont',
              department: 'Human Resources',
              email: 'marie@acme.com',
              username: null,
              lifecycle_status: null,
              is_new: true,
              needs_portal_access: true,
            },
            user_setup: card({
              name: 'WO-USER',
              work_type: 'User Setup',
              action: 'Create User',
              service_item: null,
              service_name: null,
            }),
            services: [card({ name: 'WO-SVC', ready: false, waiting_on: 'the person to be created' })],
          }),
        ],
      })
    );

    expect(screen.getByText(/portal access was requested/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/licence is issued against/i), {
      target: { value: 'm.dupont' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => expect(internal.executeUserSetup).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeUserSetup).mock.calls[0][0]).toMatchObject({
      work_order: 'WO-USER',
      username: 'm.dupont',
    });
  });

  it('says what a waiting service is waiting for', async () => {
    await renderPage(
      request(),
      plan({
        groups: [
          group({
            services: [card({ ready: false, waiting_on: 'the machine to be prepared' })],
          }),
        ],
      })
    );

    expect(screen.getByText(/waiting for the machine to be prepared/i)).toBeInTheDocument();
  });

  it('registers a new device from the card itself', async () => {
    vi.mocked(internal.executeDeviceProvisioning).mockResolvedValue(plan());
    await renderPage(request(), planWithDevice());

    fireEvent.click(screen.getByRole('button', { name: /register a new device/i }));
    fireEvent.change(screen.getByPlaceholderText('LAPTOP-MDUPONT'), {
      target: { value: 'LAPTOP-JD' },
    });
    fireEvent.change(screen.getByPlaceholderText('DELL-938828'), {
      target: { value: 'SN-4242' },
    });
    fireEvent.click(screen.getByRole('button', { name: /register and assign/i }));

    await waitFor(() => expect(internal.executeDeviceProvisioning).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeDeviceProvisioning).mock.calls[0][0]).toMatchObject({
      mode: 'new',
      hostname: 'LAPTOP-JD',
      serial_number: 'SN-4242',
    });
  });

  it('takes a machine off the shelf from the card itself', async () => {
    vi.mocked(internal.executeDeviceProvisioning).mockResolvedValue(plan());
    await renderPage(request(), planWithDevice());

    fireEvent.click(await screen.findByText('LAPTOP-STOCK-14'));
    fireEvent.click(screen.getByRole('button', { name: /assign this device/i }));

    await waitFor(() => expect(internal.executeDeviceProvisioning).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeDeviceProvisioning).mock.calls[0][0]).toMatchObject({
      mode: 'existing',
      managed_device: 'DEV-STOCK',
    });
  });

  it('never moves a machine somebody else holds without saying so', async () => {
    vi.mocked(internal.executeDeviceProvisioning).mockResolvedValue(plan());
    await renderPage(request(), planWithDevice());

    fireEvent.click(await screen.findByText('LAPTOP-14'));

    expect(screen.getByText(/currently held by Peter Holder/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /transfer to John Doe/i }));

    await waitFor(() => expect(internal.executeDeviceProvisioning).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeDeviceProvisioning).mock.calls[0][0]).toMatchObject({
      managed_device: 'DEV-HELD',
      confirm_transfer: 1,
    });
  });
});

const planWithDevice = () =>
  plan({
    groups: [
      group({
        devices: [
          {
            device_requirement_key: 'new-device:user:CU-1',
            device: null,
            work: card({
              name: 'WO-DEV',
              work_type: 'Device Provisioning',
              action: 'Register Device',
              target_scope: 'Device',
              service_item: null,
              service_name: null,
              device_requirement_key: 'new-device:user:CU-1',
            }),
          },
        ],
        services: [
          card({
            name: 'WO-SVC',
            target_scope: 'Device',
            device_requirement_key: 'new-device:user:CU-1',
            ready: false,
            waiting_on: 'the machine to be prepared',
          }),
        ],
      }),
    ],
  });

describe('acting on the service, in the request', () => {
  it('executes the act from its own card', async () => {
    vi.mocked(internal.executeServiceAction).mockResolvedValue(plan());
    await renderPage(request());

    fireEvent.click(screen.getByRole('button', { name: /activate service/i }));

    await waitFor(() => expect(internal.executeServiceAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeServiceAction).mock.calls[0][0]).toMatchObject({
      work_order: 'WO-0001',
    });
  });

  it('asks for the account name only when the person has none', async () => {
    await renderPage(
      request(),
      plan({
        groups: [
          group({
            person: {
              name: 'CU-2',
              full_name: 'No Account',
              department: null,
              email: null,
              username: null,
              lifecycle_status: 'Active',
              is_new: false,
            },
          }),
        ],
      })
    );

    expect(screen.getByPlaceholderText(/name on the licence/i)).toBeInTheDocument();
  });

  it('shows what the service is doing today before changing it', async () => {
    await renderPage(
      request(),
      plan({
        groups: [
          group({
            services: [
              card({
                action: 'Suspend',
                current: {
                  name: 'SA-1',
                  operational_status: 'Active',
                  quantity: 1,
                  effective_start_date: '2026-01-10',
                  effective_end_date: null,
                },
              }),
            ],
          }),
        ],
      })
    );

    expect(screen.getByText(/currently active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /suspend service/i })).toBeInTheDocument();
  });
});

describe('when the work will not go through', () => {
  it('blocks an item with a reason, in place', async () => {
    vi.mocked(internal.blockWorkItem).mockResolvedValue(plan());
    await renderPage(request());

    fireEvent.click(screen.getByRole('button', { name: /^block$/i }));
    fireEvent.change(screen.getByLabelText(/reason to block/i), {
      target: { value: 'Vendor licence unavailable' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(internal.blockWorkItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.blockWorkItem).mock.calls[0][0]).toMatchObject({
      reason: 'Vendor licence unavailable',
    });
  });

  it('resumes it from the same card', async () => {
    vi.mocked(internal.resumeWorkItem).mockResolvedValue(plan());
    await renderPage(
      request(),
      plan({
        groups: [
          group({
            services: [
              card({ status: 'Blocked', failure_reason: 'Vendor licence unavailable' }),
            ],
          }),
        ],
      })
    );

    expect(screen.getByText(/vendor licence unavailable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /resume work/i }));

    await waitFor(() => expect(internal.resumeWorkItem).toHaveBeenCalledTimes(1));
  });
});

describe('signing off and closing', () => {
  const awaiting = plan({
    groups: [
      group({
        services: [
          card({
            status: 'Awaiting Verification',
            resulting_assignment: 'SA-0492',
            checklist: [
              { name: 'c1', idx: 1, step: 'Service assignment written', is_done: 1, note: null },
              {
                name: 'c2',
                idx: 2,
                step: 'Confirmed working for the customer',
                is_done: 0,
                note: null,
              },
            ],
          }),
        ],
      }),
    ],
  });

  it('never asks the technician to tick what the record already proves', async () => {
    await renderPage(request(), awaiting);

    expect(screen.getByText('Service assignment written')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /assignment written/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /confirmed working/i })).toBeInTheDocument();
  });

  it('verifies from the card, with a note the customer will read', async () => {
    vi.mocked(internal.verifyWorkItem).mockResolvedValue(plan());
    await renderPage(request(), awaiting);

    fireEvent.click(screen.getByRole('checkbox', { name: /confirmed working/i }));
    fireEvent.change(screen.getByLabelText(/note for the customer/i), {
      target: { value: 'Credentials sent securely.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    await waitFor(() => expect(internal.verifyWorkItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.verifyWorkItem).mock.calls[0][0]).toMatchObject({
      work_order: 'WO-0001',
      customer_note: 'Credentials sent securely.',
    });
  });

  it('closes the file from the summary at the bottom of the request', async () => {
    vi.mocked(internal.completeRequest).mockResolvedValue(plan({ status: 'Completed' }));
    await renderPage(request());

    fireEvent.click(screen.getByRole('button', { name: /complete request/i }));

    await waitFor(() => expect(internal.completeRequest).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.completeRequest).mock.calls[0][0]).toMatchObject({
      name: 'SR-0001',
    });
  });

  it('takes the whole request in one gesture', async () => {
    vi.mocked(internal.assignRequestTechnician).mockResolvedValue(plan());
    await renderPage(request());

    fireEvent.click(screen.getByRole('button', { name: /assign this request to me/i }));

    await waitFor(() => expect(internal.assignRequestTechnician).toHaveBeenCalledTimes(1));
  });
});
