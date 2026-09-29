import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  ActionWorkGroup,
  ExecutionPlan,
  PersonFacts,
  RequestDetail as RequestDetailData,
  WorkCard,
  WorkRequirement,
} from '@/lib/api/internal';
import * as presentationApi from '@/lib/api/requestPresentation';
import type {
  RequestedEntityPresentation,
  RequestPresentation,
  RequestTargetPresentation,
} from '@/lib/api/requestPresentation';
import { completedFixture, presentationFixture } from '@/shared/request/presentation.fixture';
import {
  buildClientUserRowActions,
  buildDeviceRowActions,
  buildServiceAssignmentRowActions,
} from '../actions';
import RequestDetail from './RequestDetail';

const pageOf = <T,>(rows: T[]) => ({ rows, total: rows.length, truncated: false });

vi.mock('@/lib/api/requestPresentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/requestPresentation')>();
  return { ...actual, getInternalRequestPresentation: vi.fn() };
});

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getRequest: vi.fn(),
    getRequestExecutionPlan: vi.fn(),
    executeWorkOrders: vi.fn(),
    saveRequiredIdentifiers: vi.fn(),
    saveRequestedClientUser: vi.fn(),
    resolveRequestedClientUser: vi.fn(),
    listSelectableClientUsers: vi.fn(),
    listSelectableDevices: vi.fn(),
    listDepartmentOptions: vi.fn(),
    changeUserService: vi.fn(),
    userServiceAvailability: vi.fn(),
    completeRequest: vi.fn(),
    setRequestLineStatus: vi.fn(),
    setRequestLineStatuses: vi.fn(),
    settleWorkDoneElsewhere: vi.fn(),
    recordRequestActivity: vi.fn(),
    runRequestAction: vi.fn(),
    listCustomerDevices: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
    listCustomerRequests: vi.fn(),
    stopAllClientUserServices: vi.fn(),
  };
});

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

const card = (overrides: Partial<WorkCard> = {}): WorkCard =>
  ({
    name: 'WO-0001',
    plan_key: 'SR-0001:service:x',
    work_type: 'Service Action',
    action: 'Add',
    operation_code: 'service.add',
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
    origin: 'Request',
    action_group_key: 'grp-m365',
    requirements: [],
    checklist: [],
    requested_client_user: null,
    requested_device: null,
    requested_holder_requested_client_user: null,
    display_status: 'Ready',
    target: {
      kind: 'client_user',
      name: 'CU-1',
      requested_entity: null,
      label: 'John Doe',
      sublabel: 'Accounting',
      badge: null,
    },
    relationship: null,
    primary_action: { operation_code: 'service.add', label: 'Add service', enabled: true },
    prerequisite_action: null,
    dependency_label: null,
    ready: true,
    waiting_on: null,
    device: null,
    current: null,
    ...overrides,
  }) as WorkCard;

const actionGroup = (work: WorkCard[], overrides: Partial<ActionWorkGroup> = {}): ActionWorkGroup => ({
  group_key: 'grp-m365',
  operation_code: 'service.add',
  label: 'Add Microsoft 365',
  scope_label: 'Accounting',
  origin: 'Customer',
  total: work.length,
  remaining: work.filter((row) => !['Completed', 'Cancelled'].includes(row.display_status)).length,
  ready: work.filter((row) => row.display_status === 'Ready').length,
  needs_information: work.filter((row) => row.display_status === 'Needs information').length,
  by_status: {},
  work,
  ...overrides,
});

const person = (
  subjectKey: string,
  fullName: string,
  overrides: Partial<ExecutionPlan['people'][number]> = {}
): ExecutionPlan['people'][number] => ({
  subject_key: subjectKey,
  full_name: fullName,
  department: 'Accounting',
  is_new: false,
  client_user: subjectKey.replace('user:', ''),
  requested_client_user: null,
  total: 1,
  remaining: 1,
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
  outcome: {
    accepted: 1,
    rejected: 0,
    requested_done: 0,
    unresolved_accepted: 1,
    technician_added: 0,
    technician_done: 0,
    requested_client_users_total: 0,
    requested_client_users_resolved: 0,
    requested_devices_total: 0,
    requested_devices_resolved: 0,
  },
  stages: {
    current: 'execute',
    stages: [
      { key: 'review', label: 'Review lines', done: true, needed: true, state: 'done' },
      { key: 'execute', label: 'Execute', done: false, needed: true, state: 'current' },
      { key: 'verify', label: 'Verify', done: false, needed: true, state: 'todo' },
      { key: 'complete', label: 'Final validation', done: false, needed: true, state: 'todo' },
    ],
  },
  action_groups: [actionGroup([card()])],
  requested_entities: [],
  preparation: { new_people: 0, unresolved_devices: 0, missing_usernames: 0, missing_serials: 0 },
  people: [person('user:CU-1', 'John Doe')],
  requirements: [],
  rejected: [],
  summary: { people: 1, devices: 0, services: 1, open: 1, blocked: 0, failed: 0 },
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
    action_groups: [
      actionGroup([card({ status: 'Completed', display_status: 'Completed', completed_at: '2026-09-13 10:00:00' })]),
    ],
    people: [person('user:CU-1', 'John Doe', { remaining: 0 })],
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
    outcome: {
      accepted: 1,
      rejected: 1,
      requested_done: 1,
      unresolved_accepted: 0,
      technician_added: 1,
      technician_done: 1,
      requested_client_users_total: 0,
      requested_client_users_resolved: 0,
      requested_devices_total: 0,
      requested_devices_resolved: 0,
    },
    summary: { people: 0, devices: 0, services: 2, open: 0, blocked: 0, failed: 0 },
    ...overrides,
  });

const marie = (overrides: Partial<RequestedEntityPresentation> = {}): RequestedEntityPresentation => ({
  kind: 'client_user',
  name: 'RCU-1',
  key: 'new:marie',
  display_name: 'Marie Dupont',
  context_label: 'Requested Client User · Purchasing',
  status: 'Open',
  readiness: 'needs_review',
  badge: 'NEEDS REVIEW',
  resolved_to: null,
  requested_snapshot: { full_name: 'Marie Dupont', department: 'Purchasing', email: null, username: null },
  prepared_values: {},
  requested_work_count: 2,
  relationship_summary: [],
  ...overrides,
});

const usernameOf = (owner: string, label: string): WorkRequirement => ({
  key: `username:${owner}`,
  kind: 'username',
  blocking: true,
  satisfied: false,
  owner_type: 'MSP Client User',
  owner_name: owner,
  owner_label: label,
  owner_department: 'Accounting',
  label: 'Username',
  reason: 'Microsoft 365 is issued against a username.',
  can_batch_edit: true,
});

const needsUsername = (index: number) =>
  card({
    name: `WO-${String(index).padStart(2, '0')}`,
    subject_key: `user:CU-${index}`,
    client_user: `CU-${index}`,
    display_status: 'Needs information',
    ready: false,
    target: {
      kind: 'client_user',
      name: `CU-${index}`,
      requested_entity: null,
      label: `Person ${index}`,
      sublabel: 'Accounting',
      badge: null,
    },
    primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
    prerequisite_action: { kind: 'complete_username', label: 'Complete username', requested_entity: null },
    dependency_label: 'Username required',
    requirements: [usernameOf(`CU-${index}`, `Person ${index}`)],
  });

const readyFor = (index: number) =>
  card({
    name: `WO-${String(index).padStart(2, '0')}`,
    subject_key: `user:CU-${index}`,
    client_user: `CU-${index}`,
    target: {
      kind: 'client_user',
      name: `CU-${index}`,
      requested_entity: null,
      label: `Person ${index}`,
      sublabel: 'Accounting',
      badge: null,
    },
  });

const facts = (overrides: Partial<PersonFacts> = {}): PersonFacts => ({
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
  ...overrides,
});

const holderChange = (overrides: Partial<WorkCard> = {}) =>
  card({
    name: 'WO-HOLD',
    work_type: 'Device Operation',
    action: 'Transfer',
    operation_code: 'device.transfer',
    action_group_key: 'grp-holder',
    target_scope: 'Device',
    subject_key: 'user:CU-7',
    client_user: null,
    managed_device: 'DEV-23',
    service_item: null,
    service_name: null,
    current_holder: 'CU-7',
    current_holder_name: 'Franck Mbassi',
    requested_holder: null,
    requested_holder_name: null,
    requested_holder_requested_client_user: 'RCU-1',
    display_status: 'Waiting for prerequisite',
    ready: false,
    target: {
      kind: 'managed_device',
      name: 'DEV-23',
      requested_entity: null,
      label: 'ACI-LT-023',
      sublabel: 'Franck Mbassi → Marie Dupont',
      badge: null,
    },
    relationship: { from_label: 'Franck Mbassi', to_label: 'Marie Dupont', to_is_new: true, note: null },
    primary_action: { operation_code: 'device.transfer', label: 'Change holder', enabled: false },
    prerequisite_action: { kind: 'prepare_holder', label: 'Prepare new holder', requested_entity: 'RCU-1' },
    dependency_label: 'Requested holder must be resolved',
    device: {
      name: 'DEV-23',
      hostname: 'ACI-LT-023',
      serial_number: 'SN-0023',
      device_type: 'Laptop',
      status: 'Active',
      assigned_client_user: 'CU-7',
      holder_name: 'Franck Mbassi',
    },
    ...overrides,
  });

const holderPlan = (overrides: Partial<WorkCard> = {}, entity: RequestedEntityPresentation = marie()) =>
  plan({
    action_groups: [
      actionGroup([holderChange(overrides)], {
        group_key: 'grp-holder',
        operation_code: 'device.transfer',
        label: 'Change holder',
        scope_label: 'ACI-LT-023',
      }),
    ],
    requested_entities: [entity],
    people: [
      person('user:CU-7', 'Franck Mbassi'),
      person('new:marie', 'Marie Dupont', { is_new: true, client_user: null, requested_client_user: 'RCU-1' }),
    ],
  });

const line = (idx: number, overrides: Record<string, unknown> = {}) => ({
  idx,
  action: 'Add',
  action_label: 'Grant a service',
  action_description: null,
  target_scope: 'User',
  service_scope: 'User',
  client_user: `CU-${idx}`,
  client_user_name: `Person ${idx}`,
  client_user_department: 'Commercial',
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

const target = (idx: number, overrides: Partial<RequestTargetPresentation> = {}): RequestTargetPresentation => ({
  line_idx: idx,
  subject_key: `user:CU-${idx}`,
  person_label: `Person ${idx}`,
  person_is_new: false,
  target_label: 'VPN',
  target_kind: 'client_user',
  target_badge: null,
  operation_label: 'Add VPN',
  state_at_request: 'Not assigned',
  state_changed: false,
  relationship: null,
  line_status: 'Pending',
  rejection_reason: null,
  ...overrides,
});

const presentationOf = (
  targets: RequestTargetPresentation[] = [target(1), target(2)],
  overrides: Partial<RequestPresentation> = {}
): RequestPresentation => {
  const base = presentationFixture();
  return {
    ...base,
    request: { ...base.request, name: 'SR-0001', customer: 'ACME', customer_name: 'ACME', requester_name: 'Someone' },
    summary: { people: targets.length, requested_actions: 1, concrete_targets: targets.length, new_entities: 0 },
    subjects: targets.map((row) => ({
      subject_key: row.subject_key ?? '',
      full_name: row.person_label ?? '',
      department: 'Commercial',
      type: row.person_is_new ? 'new' : 'existing',
      client_user: row.person_is_new ? null : (row.subject_key ?? '').replace('user:', ''),
      requested_client_user: null,
      related_work_count: 1,
    })),
    action_groups: [
      {
        group_key: 'grp-vpn',
        operation_code: 'service.add',
        operation_label: 'Add VPN',
        domain: 'Service',
        context_label: 'All selected · Personal service',
        impact_label: `${targets.length} targets from ${targets.length} people`,
        impact_detail: null,
        target_count: targets.length,
        unchanged_count: 0,
        badges: [],
        relationship: null,
        targets,
        unchanged: [],
      },
    ],
    requested_entities: [],
    attention: [],
    ...overrides,
  };
};

const renderPage = async (
  detail: RequestDetailData,
  work?: ExecutionPlan,
  shown: RequestPresentation = presentationOf()
) => {
  vi.mocked(presentationApi.getInternalRequestPresentation).mockResolvedValue(shown);
  vi.mocked(internal.getRequest).mockResolvedValue(detail);
  vi.mocked(internal.getRequestExecutionPlan).mockResolvedValue(work ?? plan());
  vi.mocked(internal.listCustomerRequests).mockResolvedValue([
    { name: 'SR-0001', request_type: 'Add', customer: 'ACME', status: 'In Progress', creation: '2026-09-01', requester: null },
  ] as never);
  vi.mocked(internal.listDepartmentOptions).mockResolvedValue([{ value: 'Purchasing', label: 'Purchasing' }]);
  vi.mocked(internal.settleWorkDoneElsewhere).mockResolvedValue(work ?? plan());
  vi.mocked(internal.getDeviceFilterOptions).mockResolvedValue({
    device_types: ['PC', 'Laptop'],
    interface_types: ['Ethernet'],
    statuses: [],
    customers: [],
  } as unknown as Awaited<ReturnType<typeof internal.getDeviceFilterOptions>>);
  vi.mocked(internal.listCustomerDevices).mockResolvedValue([]);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/requests/SR-0001']}>
        <Routes>
          <Route path="/msp/requests/:name" element={<RequestDetail />} />
          <Route path="/msp/requests" element={<div>Requests listing</div>} />
          <Route path="/msp/devices/:device" element={<div>Device page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText(/SR-0001/);
};

const rowOf = (workOrder: string) => document.querySelector(`[data-work-order="${workOrder}"]`) as HTMLElement;

const entityRowOf = (name: string) =>
  document.querySelector(`[data-requested-entity="${name}"]`) as HTMLElement;

const openedLabels = async (row: HTMLElement) => {
  fireEvent.click(within(row).getByTitle('More options'));
  const menu = await screen.findByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);
};

const visibleLabels = (actions: { label: string; disabled?: boolean }[]) =>
  actions.filter((action) => !action.disabled).map((action) => action.label);

const noop = () => undefined;

const executionRail = () => screen.findByRole('complementary', { name: 'Execution view' });

const railEntry = async (name: string) =>
  within(await executionRail()).getByRole('button', { name: new RegExp(`^${name}`) });

const pickView = async (name: string) => {
  fireEvent.click(await railEntry(name));
};

const confirmDate = async (label: string) => {
  const dialog = await screen.findByRole('dialog');
  expect(internal.executeWorkOrders).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
};

const dated = (workOrder: string, effectiveDate = '2026-09-15') => ({
  work_order: workOrder,
  inputs: { effective_date: effectiveDate },
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the request stays in view at every step', () => {
  it('shows the compact header: name, customer · source · submitted date, badges and the business note', async () => {
    const shown = presentationOf();
    shown.request.customer_name = 'ACME Corporation';
    shown.request.details = 'Please prepare everything before Monday.';
    shown.request.details_by = 'Devteam Cam';
    await renderPage(request(), plan({ requested_entities: [marie()] }), shown);

    const header = await screen.findByRole('region', { name: 'Request' });
    expect(within(header).getByRole('heading', { name: 'SR-0001' })).toBeInTheDocument();
    expect(within(header).getByText('ACME Corporation · Portal · Submitted 27 Sep 2026')).toBeInTheDocument();
    for (const badge of ['CUSTOMER APPROVED', 'HIGH', '1 ACTION GROUP']) {
      expect(within(header).getByText(badge)).toBeInTheDocument();
    }
    expect(await within(header).findByText('1 REQUESTED ENTITY')).toBeInTheDocument();
    expect(within(header).getByText('Request note')).toBeInTheDocument();
    expect(within(header).getByText('Please prepare everything before Monday.')).toBeInTheDocument();
    expect(header.textContent).not.toMatch(/assign|technician|owner/i);
  });

  it('walks exactly four steps', async () => {
    await renderPage(request(), plan());
    await screen.findByText('Execution view');

    for (const label of ['Review lines', 'Execute', 'Verify', 'Final validation']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText('Prepare')).not.toBeInTheDocument();
  });
});

describe('a request sent to Nexgen, before the work starts', () => {
  const submitted = () =>
    request({ status: 'Submitted', can_decide_lines: false, can_start: true, lines: [line(1), line(2)] } as never);

  it('is read through the shared presentation, with only "Start work" and "Reject"', async () => {
    await renderPage(submitted());

    const heading = await screen.findByRole('heading', { name: 'Request SR-0001' });
    const header = heading.closest('section') as HTMLElement;
    expect(document.querySelector('[data-mode="internal_detail"]')).not.toBeNull();
    expect(within(header).getByRole('button', { name: 'Start work' })).toBeEnabled();
    expect(within(header).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
    for (const control of ['Accept', 'Accept all', 'Accept all remaining', 'Reject all', 'Reject line', 'Continue to Execute']) {
      expect(screen.queryByRole('button', { name: control }), control).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Review lines' })).not.toBeInTheDocument();
    expect(internal.setRequestLineStatus).not.toHaveBeenCalled();
    expect(internal.setRequestLineStatuses).not.toHaveBeenCalled();
  });

  it('starts the work with the action start_review, and the review step appears', async () => {
    vi.mocked(internal.runRequestAction).mockResolvedValue(reviewing());
    await renderPage(submitted());

    fireEvent.click(await screen.findByRole('button', { name: 'Start work' }));

    await waitFor(() =>
      expect(internal.runRequestAction).toHaveBeenCalledWith({ name: 'SR-0001', action: 'start_review' })
    );
    expect(internal.runRequestAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Review lines' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(2);
  });

  it('offers no "Start work" once the request is under review', async () => {
    await renderPage(reviewing());

    expect(await screen.findByRole('heading', { name: 'Review lines' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument();
  });
});

describe('step 1 — review lines', () => {
  it('executes nothing and asks for a decision on every line', async () => {
    await renderPage(reviewing());

    expect(await screen.findByRole('heading', { name: 'Review lines' })).toBeInTheDocument();
    expect(screen.getByText('Accept or reject the requested work. Nothing is executed here.')).toBeInTheDocument();
    expect(screen.getByText('2 decisions remaining')).toBeInTheDocument();
    expect(
      await screen.findByText('Every line must be accepted or rejected before execution.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to Execute' })).toBeDisabled();
    expect(internal.getRequestExecutionPlan).not.toHaveBeenCalled();
  });

  it('reads the request through the shared presentation, action groups first', async () => {
    await renderPage(reviewing());

    const group = await screen.findByText('Add VPN', { selector: 'p.text-sm' });
    expect(group).toBeInTheDocument();
    expect(screen.getByText('2 targets from 2 people')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'People' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-group] table')).toHaveLength(1);
    expect(presentationApi.getInternalRequestPresentation).toHaveBeenCalledWith('SR-0001', expect.anything());
  });

  it('accepts a whole group with exactly its pending lines, written line by line', async () => {
    const detail = reviewing([line(1), line(2, { line_status: 'Approved' }), line(3)]);
    await renderPage(
      detail,
      undefined,
      presentationOf([target(1), target(2, { line_status: 'Approved' }), target(3)])
    );
    vi.mocked(internal.setRequestLineStatuses).mockResolvedValue({
      results: [
        { idx: 1, ok: true, message: null },
        { idx: 3, ok: true, message: null },
      ],
      decided: 2,
      failed: 0,
      request: detail,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Accept all' }));

    await waitFor(() =>
      expect(internal.setRequestLineStatuses).toHaveBeenCalledWith({
        name: 'SR-0001',
        idxs: [1, 3],
        line_status: 'Approved',
      })
    );
  });

  it('accepts everything still to decide in one click, whatever group it sits in', async () => {
    const detail = reviewing([line(1), line(2, { line_status: 'Rejected', rejection_reason: 'No' }), line(3), line(4)]);
    await renderPage(
      detail,
      undefined,
      presentationOf([target(1), target(2, { line_status: 'Rejected', rejection_reason: 'No' }), target(3), target(4)])
    );
    vi.mocked(internal.setRequestLineStatuses).mockResolvedValue({
      results: [1, 3, 4].map((idx) => ({ idx, ok: true, message: null })),
      decided: 3,
      failed: 0,
      request: detail,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Accept all remaining' }));

    await waitFor(() =>
      expect(internal.setRequestLineStatuses).toHaveBeenCalledWith({
        name: 'SR-0001',
        idxs: [1, 3, 4],
        line_status: 'Approved',
      })
    );
    expect(internal.setRequestLineStatuses).toHaveBeenCalledTimes(1);
  });

  it('does not offer it when a single decision is left, or none', async () => {
    await renderPage(
      reviewing([line(1), line(2, { line_status: 'Approved' })]),
      undefined,
      presentationOf([target(1), target(2, { line_status: 'Approved' })])
    );

    expect(await screen.findByRole('button', { name: 'Continue to Execute' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Accept all remaining' })).not.toBeInTheDocument();
  });

  it('rejects a whole group with a reason, for exactly its pending lines', async () => {
    const detail = reviewing([line(1), line(2, { line_status: 'Rejected', rejection_reason: 'No' }), line(3)]);
    await renderPage(
      detail,
      undefined,
      presentationOf([target(1), target(2, { line_status: 'Rejected', rejection_reason: 'No' }), target(3)])
    );
    vi.mocked(internal.setRequestLineStatuses).mockResolvedValue({
      results: [],
      decided: 2,
      failed: 0,
      request: detail,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Reject all' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject request' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Out of contract' } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(internal.setRequestLineStatuses).toHaveBeenCalledWith({
        name: 'SR-0001',
        idxs: [1, 3],
        line_status: 'Rejected',
        reason: 'Out of contract',
      })
    );
  });

  it('offers no group decision once a group has nothing pending', async () => {
    await renderPage(
      reviewing([line(1, { line_status: 'Approved' }), line(2, { line_status: 'Approved' })]),
      undefined,
      presentationOf([target(1, { line_status: 'Approved' }), target(2, { line_status: 'Approved' })])
    );

    expect(await screen.findByRole('button', { name: 'Accept all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject all' })).toBeDisabled();
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

    fireEvent.click(await screen.findByRole('button', { name: 'Accept all' }));

    expect(await screen.findByText(/1 accepted, 1 not/i)).toBeInTheDocument();
    expect(screen.getByText(/line 2 — line 2 not found/i)).toBeInTheDocument();
  });

  it('will not reject a line without a reason', async () => {
    await renderPage(reviewing());

    const firstLine = (await screen.findByText('Person 1', { selector: 'td' })).closest('tr') as HTMLElement;
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

  it('accepts one line by its line index', async () => {
    await renderPage(reviewing());
    vi.mocked(internal.setRequestLineStatus).mockResolvedValue(reviewing());

    const second = (await screen.findByText('Person 2', { selector: 'td' })).closest('tr') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: /^accept$/i }));

    await waitFor(() =>
      expect(internal.setRequestLineStatus).toHaveBeenCalledWith({
        name: 'SR-0001',
        idx: 2,
        line_status: 'Approved',
      })
    );
  });

  it('decides a single-target group from its row, by that line index, with no table until "View details"', async () => {
    await renderPage(reviewing([line(4)]), undefined, presentationOf([target(4)]));
    vi.mocked(internal.setRequestLineStatus).mockResolvedValue(reviewing([line(4)]));

    const group = (await screen.findByText('Add VPN', { selector: 'p.text-sm' })).closest('[data-group]') as HTMLElement;
    expect(within(group).queryByRole('table')).not.toBeInTheDocument();
    expect(within(group).getAllByRole('button', { name: /^accept$/i })).toHaveLength(1);
    expect(within(group).getAllByRole('button', { name: /^reject$/i })).toHaveLength(1);
    expect(within(group).queryByRole('button', { name: 'Accept all' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole('button', { name: /^accept$/i }));
    await waitFor(() =>
      expect(internal.setRequestLineStatus).toHaveBeenCalledWith({ name: 'SR-0001', idx: 4, line_status: 'Approved' })
    );
    expect(internal.setRequestLineStatuses).not.toHaveBeenCalled();

    fireEvent.click(within(group).getByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject line' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Not covered' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(internal.setRequestLineStatus).toHaveBeenCalledWith({
        name: 'SR-0001',
        idx: 4,
        line_status: 'Rejected',
        reason: 'Not covered',
      })
    );

    fireEvent.click(within(group).getByRole('button', { name: 'View details' }));
    expect(within(group).getByRole('table')).toBeInTheDocument();
    expect(within(group).getAllByRole('button', { name: /^accept$/i })).toHaveLength(1);
  });

  it('shows a decided line with its decision and its reason', async () => {
    await renderPage(
      reviewing([line(1), line(2, { line_status: 'Rejected', rejection_reason: 'Duplicate licence' })]),
      undefined,
      presentationOf([target(1), target(2, { line_status: 'Rejected', rejection_reason: 'Duplicate licence' })])
    );

    const second = (await screen.findByText('Person 2', { selector: 'td' })).closest('tr') as HTMLElement;
    expect(within(second).getByText('REJECTED')).toBeInTheDocument();
    expect(within(second).getByText('Duplicate licence')).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    expect(within(second).getByRole('button', { name: /^accept$/i })).toBeInTheDocument();
  });

  it('moves on to Execute once every line is decided and one is accepted', async () => {
    const decided = reviewing([line(1, { line_status: 'Approved' }), line(2, { line_status: 'Rejected', rejection_reason: 'No' })]);
    await renderPage(
      decided,
      undefined,
      presentationOf([target(1, { line_status: 'Approved' }), target(2, { line_status: 'Rejected', rejection_reason: 'No' })])
    );
    vi.mocked(internal.runRequestAction).mockResolvedValue(decided);

    expect(await screen.findByText(/1 accepted · 1 rejected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue to execute/i }));

    await waitFor(() =>
      expect(internal.runRequestAction).toHaveBeenCalledWith({ name: 'SR-0001', action: 'approve' })
    );
  });

  it('never names an assignee', async () => {
    await renderPage(reviewing());
    await screen.findByText('Every line must be accepted or rejected before execution.');

    expect(document.body.textContent).not.toMatch(/Assigned|Assignee|Owner|Technician/);
  });
});



describe('step 2 — execute', () => {
  it('starts the work directly: a ready row keeps its requested-operation button and its … menu', async () => {
    vi.mocked(internal.executeWorkOrders).mockResolvedValue({
      results: [{ work_order: 'WO-0001', ok: true, message: null }],
      completed: 1,
      skipped: 0,
      failed: 0,
      plan: plan({
        action_groups: [actionGroup([card({ display_status: 'Completed', primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false } })])],
      }),
    });
    await renderPage(request(), plan());

    const row = await waitFor(() => rowOf('WO-0001'));
    expect(screen.queryByText('Progress is saved as work is completed.')).not.toBeInTheDocument();
    expect(screen.queryByText('Progress saved automatically')).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Add service' })).toBeEnabled();
    expect(within(row).getAllByTitle('More options')).toHaveLength(1);
    expect(screen.queryByText(/assigned technician/i)).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Add service' }));
    await confirmDate('Add service');

    await waitFor(() =>
      expect(internal.executeWorkOrders).toHaveBeenCalledWith({
        request: 'SR-0001',
        executions: [dated('WO-0001')],
      })
    );
    expect(await screen.findByText('Progress saved automatically')).toBeInTheDocument();
    expect(within(rowOf('WO-0001')).getByRole('button', { name: 'Add service' })).toBeDisabled();
  });

  it('keeps a blocked Add service disabled next to Complete username and the … menu', async () => {
    await renderPage(request(), plan({ action_groups: [actionGroup([needsUsername(1)])] }));

    const row = await waitFor(() => rowOf('WO-01'));
    expect(within(row).getByRole('button', { name: 'Add service' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Complete username' })).toBeEnabled();
    expect(within(row).getByTitle('More options')).toBeInTheDocument();
    expect(within(row).getByText('Username required')).toBeInTheDocument();
    expect(within(row).getByText('Needs information')).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Complete username' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Complete required usernames')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter the values you know now. Saved values remain available when you return.')
    ).toBeInTheDocument();
    for (const column of ['Person', 'Department', 'Username', 'Status']) {
      expect(within(dialog).getByRole('columnheader', { name: column })).toBeInTheDocument();
    }
    for (const button of ['Cancel', 'Save progress', 'Save & continue']) {
      expect(within(dialog).getByRole('button', { name: button })).toBeInTheDocument();
    }
  });

  it('keeps a blocked Change holder disabled under the Create user row, then enables it once the holder is resolved', async () => {
    const resolved = holderPlan(
      {
        display_status: 'Ready',
        ready: true,
        primary_action: { operation_code: 'device.transfer', label: 'Change holder', enabled: true },
        prerequisite_action: null,
        dependency_label: null,
        requested_holder: 'CU-1054',
        requested_holder_name: 'Marie Dupont',
        relationship: { from_label: 'Franck Mbassi', to_label: 'Marie Dupont', to_is_new: false, note: null },
      },
      marie({
        status: 'Resolved',
        readiness: 'resolved',
        badge: 'RESOLVED',
        resolved_to: { doctype: 'MSP Client User', name: 'CU-1054', label: 'Marie Dupont', mode: 'Use Existing' },
      })
    );
    vi.mocked(internal.listSelectableClientUsers).mockResolvedValue(pageOf([
      {
        name: 'CU-1054',
        full_name: 'Marie Dupont',
        department: 'Purchasing',
        username: null,
        email: null,
        lifecycle_status: 'Active',
        selectable: true,
        disabled_reason: null,
      },
    ]));
    vi.mocked(internal.resolveRequestedClientUser).mockResolvedValue({ entity: resolved.requested_entities[0], plan: resolved });
    vi.mocked(internal.executeWorkOrders).mockResolvedValue({
      results: [{ work_order: 'WO-HOLD', ok: true, message: null }],
      completed: 1,
      skipped: 0,
      failed: 0,
      plan: resolved,
    });
    await renderPage(request(), holderPlan());

    let row = await waitFor(() => rowOf('WO-HOLD'));
    expect(within(row).getByRole('button', { name: 'Change holder' })).toBeDisabled();
    expect(within(row).queryByRole('button', { name: 'Prepare new holder' })).not.toBeInTheDocument();
    expect(within(row).getByTitle('More options')).toBeInTheDocument();
    expect(within(row).getByText('Franck Mbassi → Marie Dupont')).toBeInTheDocument();
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByText('Waits for Marie Dupont')).toBeInTheDocument();
    const holder = entityRowOf('RCU-1');
    expect(within(holder).getByRole('button', { name: 'Create user' })).toBeEnabled();

    fireEvent.click(within(holder).getByRole('button', { name: 'Create user' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Prepare requested Client User')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing' }));
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Marie Dupont' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & resolve' }));

    await waitFor(() =>
      expect(internal.resolveRequestedClientUser).toHaveBeenCalledWith({
        name: 'RCU-1',
        mode: 'existing',
        client_user: 'CU-1054',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    row = rowOf('WO-HOLD');
    expect(within(row).getByRole('button', { name: 'Change holder' })).toBeEnabled();
    expect(within(row).queryByText('Waits for Marie Dupont')).not.toBeInTheDocument();
    expect(within(row).getByText('Franck Mbassi → Marie Dupont')).toBeInTheDocument();
    expect(within(row).queryByText('NEW')).not.toBeInTheDocument();
    expect(within(entityRowOf('RCU-1')).queryByRole('button', { name: 'Create user' })).not.toBeInTheDocument();
    expect(within(entityRowOf('RCU-1')).getByText('CU-1054 · Existing Client User selected')).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Change holder' }));
    await confirmDate('Change holder');
    await waitFor(() =>
      expect(internal.executeWorkOrders).toHaveBeenCalledWith({
        request: 'SR-0001',
        executions: [dated('WO-HOLD')],
      })
    );
  });

  describe('handing a machine over to somebody else than requested', () => {
    const readyHolder = () =>
      holderPlan({
        requested_holder: 'CU-20',
        requested_holder_name: 'Marie Dupont',
        requested_holder_requested_client_user: null,
        display_status: 'Ready',
        ready: true,
        primary_action: { operation_code: 'device.transfer', label: 'Change holder', enabled: true },
        prerequisite_action: null,
        dependency_label: null,
      });

    const openHandOver = async () => {
      vi.mocked(internal.listSelectableClientUsers).mockResolvedValue(pageOf([
        { name: 'CU-20', full_name: 'Marie Dupont', department: 'Purchasing', username: null, email: null, lifecycle_status: 'Disabled', selectable: false, disabled_reason: 'This record is disabled and cannot be selected.' },
        { name: 'CU-30', full_name: 'Paul Ebong', department: 'Operations', username: null, email: null, lifecycle_status: 'Active', selectable: true, disabled_reason: null },
        { name: 'CU-31', full_name: 'Old Timer', department: null, username: null, email: null, lifecycle_status: 'Archived', selectable: false, disabled_reason: 'This record is disabled and cannot be selected.' },
      ]));
      vi.mocked(internal.executeWorkOrders).mockResolvedValue({
        results: [{ work_order: 'WO-HOLD', ok: true, message: null }],
        completed: 1,
        skipped: 0,
        failed: 0,
        plan: readyHolder(),
      });
      await renderPage(request(), readyHolder());
      fireEvent.click(within(await waitFor(() => rowOf('WO-HOLD'))).getByRole('button', { name: 'Change holder' }));
      return screen.findByRole('dialog');
    };

    const pickHolder = async (dialog: HTMLElement, name: string) => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^Hand over to/ }));
      fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name}`) }));
    };

    it('sends neither field when the requested holder is kept', async () => {
      const dialog = await openHandOver();

      expect(within(dialog).getByRole('button', { name: /^Hand over to/ })).toHaveTextContent('Marie Dupont');
      expect(within(dialog).queryByLabelText('Reason')).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change holder' }));

      await waitFor(() =>
        expect(internal.executeWorkOrders).toHaveBeenCalledWith({
          request: 'SR-0001',
          executions: [dated('WO-HOLD')],
        })
      );
    });

    it('will not hand it to somebody else without a reason, and greys who cannot receive it', async () => {
      const dialog = await openHandOver();

      fireEvent.click(within(dialog).getByRole('button', { name: /^Hand over to/ }));
      await waitFor(() => expect(internal.listSelectableClientUsers).toHaveBeenCalledWith('ACME', undefined, expect.anything()));
      expect(await screen.findByRole('option', { name: /^Old Timer/ })).toBeDisabled();
      expect(screen.getByRole('option', { name: /^Paul Ebong/ })).toBeEnabled();
      expect(screen.getAllByRole('option', { name: /^Marie Dupont/ })).toHaveLength(1);
      fireEvent.click(screen.getByRole('option', { name: /^Paul Ebong/ }));

      expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument();
      expect(within(dialog).getByText('Explain why this Device goes to somebody else than requested.')).toBeInTheDocument();
      const confirm = within(dialog).getByRole('button', { name: 'Change holder' });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(internal.executeWorkOrders).not.toHaveBeenCalled();
    });

    it('sends the holder and the reason when somebody else receives it', async () => {
      const dialog = await openHandOver();

      await pickHolder(dialog, 'Paul Ebong');
      fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Marie left the company.' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change holder' }));

      await waitFor(() =>
        expect(internal.executeWorkOrders).toHaveBeenCalledWith({
          request: 'SR-0001',
          executions: [
            {
              work_order: 'WO-HOLD',
              inputs: {
                effective_date: '2026-09-15',
                execution_holder: 'CU-30',
                override_reason: 'Marie left the company.',
              },
            },
          ],
        })
      );
    });

    it('offers no other holder while the requested person is still to be resolved', async () => {
      await renderPage(request(), holderPlan({ ready: true, primary_action: { operation_code: 'device.transfer', label: 'Change holder', enabled: true } }));
      fireEvent.click(within(await waitFor(() => rowOf('WO-HOLD'))).getByRole('button', { name: 'Change holder' }));
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).queryByRole('button', { name: /^Hand over to/ })).not.toBeInTheDocument();
    });
  });

  it('reads who holds a machine and who is to hold it from the server relationship, never from the holder fields', async () => {
    await renderPage(
      request(),
      holderPlan({
        current_holder_name: 'Somebody Else',
        requested_holder_name: 'Another Person',
        relationship: {
          from_label: 'Franck Mbassi',
          to_label: 'Marie Dupont',
          to_is_new: true,
          note: 'Destination is not yet a Client User',
        },
      })
    );

    const row = await waitFor(() => rowOf('WO-HOLD'));
    expect(within(row).getByText('Franck Mbassi → Marie Dupont')).toBeInTheDocument();
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByText('Destination is not yet a Client User')).toBeInTheDocument();
    expect(within(row).queryByText(/Somebody Else|Another Person/)).not.toBeInTheDocument();
  });

  it('shows the server sublabel under a target that has no relationship, and invents none', async () => {
    await renderPage(
      request(),
      holderPlan({
        relationship: null,
        current_holder_name: 'Franck Mbassi',
        requested_holder_name: 'Marie Dupont',
        target: {
          kind: 'managed_device',
          name: 'DEV-23',
          requested_entity: null,
          label: 'ACI-LT-023',
          sublabel: 'requested for Franck Mbassi',
          badge: null,
        },
      })
    );

    const row = await waitFor(() => rowOf('WO-HOLD'));
    expect(within(row).getByText('requested for Franck Mbassi')).toBeInTheDocument();
    expect(within(row).queryByText(/→/)).not.toBeInTheDocument();
    expect(within(row).queryByText('NEW')).not.toBeInTheDocument();
  });

  it('sends the owner type of a username kept for a future person', async () => {
    const future = card({
      name: 'WO-NEW',
      subject_key: 'new:marie',
      client_user: null,
      requested_client_user: 'RCU-1',
      display_status: 'Needs information',
      ready: false,
      target: {
        kind: 'requested_client_user',
        name: null,
        requested_entity: 'RCU-1',
        label: 'Marie Dupont',
        sublabel: 'Purchasing',
        badge: 'NEW',
      },
      primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
      prerequisite_action: { kind: 'complete_username', label: 'Complete username', requested_entity: null },
      dependency_label: 'Username required',
      requirements: [
        {
          ...usernameOf('RCU-1', 'Marie Dupont'),
          owner_type: 'MSP Requested Client User',
          owner_department: 'Purchasing',
        },
      ],
    });
    vi.mocked(internal.saveRequiredIdentifiers).mockResolvedValue({
      results: [{ owner: 'RCU-1', kind: 'username', ok: true, message: null, code: null }],
      saved: 1,
      failed: 0,
      plan: plan({ action_groups: [actionGroup([future])] }),
    });
    await renderPage(request(), plan({ action_groups: [actionGroup([future])], requested_entities: [marie()] }));
    await pickView('All remaining work');

    fireEvent.click(within(await waitFor(() => rowOf('WO-NEW'))).getByRole('button', { name: 'Complete username' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Username for Marie Dupont' }), {
      target: { value: 'm.dupont' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));

    await waitFor(() => expect(internal.saveRequiredIdentifiers).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.saveRequiredIdentifiers).mock.calls[0][0].values).toEqual([
      {
        kind: 'username',
        owner: 'RCU-1',
        owner_type: 'MSP Requested Client User',
        value: 'm.dupont',
        modified: null,
      },
    ]);
  });

  it('saves the same row twice with the modified value the first save returned', async () => {
    const futureAt = (modified: string, satisfied: boolean) =>
      card({
        name: 'WO-NEW',
        subject_key: 'new:marie',
        client_user: null,
        requested_client_user: 'RCU-1',
        display_status: 'Needs information',
        ready: false,
        target: {
          kind: 'requested_client_user',
          name: null,
          requested_entity: 'RCU-1',
          label: 'Marie Dupont',
          sublabel: 'Purchasing',
          badge: 'NEW',
        },
        primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
        prerequisite_action: { kind: 'complete_username', label: 'Complete username', requested_entity: null },
        dependency_label: 'Username required',
        requirements: [
          {
            ...usernameOf('RCU-1', 'Marie Dupont'),
            owner_type: 'MSP Requested Client User',
            owner_modified: modified,
            satisfied,
          },
        ],
      });
    vi.mocked(internal.saveRequiredIdentifiers).mockResolvedValue({
      results: [{ owner: 'RCU-1', kind: 'username', ok: true, message: null, code: null }],
      saved: 1,
      failed: 0,
      plan: plan({ action_groups: [actionGroup([futureAt('2026-09-28 10:00:05.000001', true)])] }),
    });
    await renderPage(
      request(),
      plan({ action_groups: [actionGroup([futureAt('2026-09-28 09:00:00.000000', false)])], requested_entities: [marie()] })
    );
    await pickView('All remaining work');

    fireEvent.click(within(await waitFor(() => rowOf('WO-NEW'))).getByRole('button', { name: 'Complete username' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByRole('textbox', { name: 'Username for Marie Dupont' });
    fireEvent.change(field, { target: { value: 'm.dupont' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));
    await waitFor(() => expect(internal.saveRequiredIdentifiers).toHaveBeenCalledTimes(1));
    await within(dialog).findByText('SAVED');

    fireEvent.change(field, { target: { value: 'marie.dupont' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));
    await waitFor(() => expect(internal.saveRequiredIdentifiers).toHaveBeenCalledTimes(2));

    const [first, second] = vi.mocked(internal.saveRequiredIdentifiers).mock.calls.map(([call]) => call.values[0]);
    expect(first).toMatchObject({ value: 'm.dupont', modified: '2026-09-28 09:00:00.000000' });
    expect(second).toMatchObject({ value: 'marie.dupont', modified: '2026-09-28 10:00:05.000001' });
    expect(await within(dialog).findByText('SAVED')).toBeInTheDocument();
    expect(within(dialog).queryByText('ERROR')).not.toBeInTheDocument();
  });

  it('opens the requested Device from its Prepare Device row, chosen by its kind', async () => {
    const machine: RequestedEntityPresentation = {
      kind: 'device',
      name: 'RDEV-1',
      key: 'new-device:laptop',
      display_name: 'New laptop',
      context_label: 'Requested Device · Laptop',
      status: 'Open',
      readiness: 'needs_information',
      badge: 'NEEDS INFORMATION',
      resolved_to: null,
      requested_snapshot: { device_type: 'Laptop', hostname: null, serial_number: null },
      prepared_values: {},
      requested_work_count: 1,
      relationship_summary: [],
    };
    const waiting = card({
      name: 'WO-DEV',
      target_scope: 'Device',
      requested_device: 'RDEV-1',
      display_status: 'Waiting for prerequisite',
      ready: false,
      target: {
        kind: 'requested_device',
        name: null,
        requested_entity: 'RDEV-1',
        label: 'New laptop',
        sublabel: 'requested for John Doe',
        badge: 'UNRESOLVED',
      },
      primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
      prerequisite_action: {
        kind: 'complete_device_information',
        label: 'Complete Device information',
        requested_entity: 'RDEV-1',
      },
      dependency_label: 'Requested Device must be resolved',
    });
    vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf([]));
    await renderPage(request(), plan({ action_groups: [actionGroup([waiting])], requested_entities: [machine] }));

    const row = await waitFor(() => rowOf('WO-DEV'));
    expect(within(row).getByRole('button', { name: 'Add service' })).toBeDisabled();
    expect(within(row).queryByRole('button', { name: 'Complete Device information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Prepare \d+ prerequisite/ })).not.toBeInTheDocument();

    fireEvent.click(within(entityRowOf('RDEV-1')).getByRole('button', { name: 'Prepare Device' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Prepare requested Device')).toBeInTheDocument();
    expect(within(dialog).queryByText('Complete required serial numbers')).not.toBeInTheDocument();
  });

  it('keeps the … control of a still-requested target in place, disabled, with its explanation', async () => {
    const pending = card({
      name: 'WO-MARIE',
      subject_key: 'new:marie',
      client_user: null,
      requested_client_user: 'RCU-1',
      display_status: 'Waiting for prerequisite',
      target: {
        kind: 'requested_client_user',
        name: null,
        requested_entity: 'RCU-1',
        label: 'Marie Dupont',
        sublabel: 'Purchasing',
        badge: 'NEW',
      },
      primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
      prerequisite_action: { kind: 'prepare_person', label: 'Prepare person', requested_entity: 'RCU-1' },
      dependency_label: 'Requested Client User must be resolved',
    });
    await renderPage(
      request(),
      plan({ action_groups: [actionGroup([pending])], requested_entities: [marie()] })
    );
    await pickView('All remaining work');

    const row = await waitFor(() => rowOf('WO-MARIE'));
    const more = within(row).getByRole('button', { name: 'More options' });
    expect(more).toBeDisabled();
    expect(more).toHaveAccessibleDescription(
      'Resolve this requested target before using its standard detail actions.'
    );
    expect(within(row).getByRole('button', { name: 'Add service' })).toBeDisabled();
    expect(within(row).queryByRole('button', { name: 'Prepare person' })).not.toBeInTheDocument();
    expect(within(entityRowOf('RCU-1')).getByRole('button', { name: 'Create user' })).toBeEnabled();
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(await openedLabels(entityRowOf('RCU-1'))).toEqual(['Cancel']);
  });

  it('gives a person row the User page menu, minus exactly the row operation', async () => {
    await renderPage(request({ people: { 'CU-1': facts() } } as never), plan());

    const labels = await openedLabels(await waitFor(() => rowOf('WO-0001')));
    const page = visibleLabels(
      buildClientUserRowActions({
        lifecycleStatus: 'Active',
        canWrite: true,
        hasOpenPersonalServices: true,
        devices: [{ name: 'DEV-1', label: 'KV-JDOE' }],
        onAddService: noop,
        onAssignDevice: noop,
        onAddServiceOnDevice: noop,
        onReturnDeviceToStock: noop,
        onEdit: noop,
        onChangeStatus: noop,
        onStopAllServices: noop,
      })
    );

    expect(labels).toEqual(page.filter((label) => label !== 'Add service'));
    expect(labels).toContain('Add service on KV-JDOE');
    expect(labels).not.toContain('More actions');
    expect(document.body.textContent).not.toMatch(/Add additional work/i);
  });

  it('gives a service row the service assignment menu, minus exactly the row operation, with the same modal', async () => {
    const suspend = card({
      action: 'Suspend',
      operation_code: 'service.suspend',
      source_service_assignment: 'SA-1',
      primary_action: { operation_code: 'service.suspend', label: 'Suspend service', enabled: true },
      current: {
        name: 'SA-1',
        operational_status: 'Active',
        quantity: 1,
        effective_start_date: '2026-01-01',
        effective_end_date: null,
      },
    });
    vi.mocked(internal.changeUserService).mockResolvedValue({} as never);
    await renderPage(request(), plan({ action_groups: [actionGroup([suspend])] }));

    const labels = await openedLabels(await waitFor(() => rowOf('WO-0001')));
    const page = visibleLabels(
      buildServiceAssignmentRowActions({
        status: 'Active',
        canWrite: true,
        currentHolding: true,
        onSuspend: noop,
        onResume: noop,
        onChange: noop,
        onEnd: noop,
      })
    );
    expect(labels).toEqual(page.filter((label) => label !== 'Suspend'));
    expect(labels).toEqual(['Change service', 'Stop service']);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop service' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Stop this service?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop service' }));

    await waitFor(() =>
      expect(vi.mocked(internal.changeUserService).mock.calls[0][0]).toMatchObject({
        assignment: 'SA-1',
        action: 'End',
        source_request: 'SR-0001',
      })
    );
  });

  it('gives a device row the Device menu, minus exactly the row operation', async () => {
    const ready = holderChange({
      display_status: 'Ready',
      primary_action: { operation_code: 'device.transfer', label: 'Change holder', enabled: true },
      prerequisite_action: null,
      requested_holder_requested_client_user: null,
      requested_holder: 'CU-2',
      requested_holder_name: 'Jane Roe',
    });
    await renderPage(request(), plan({ action_groups: [actionGroup([ready], { label: 'Change holder' })] }));
    await pickView('Change holder');

    const labels = await openedLabels(await waitFor(() => rowOf('WO-HOLD')));
    const page = visibleLabels(
      buildDeviceRowActions({
        canWrite: true,
        onAddService: noop,
        onTransfer: noop,
        onReturnToStock: noop,
        onOpen: noop,
      })
    );
    expect(labels).toEqual(page.filter((label) => label !== 'Transfer to someone else'));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open device' }));
    expect(await screen.findByText('Device page')).toBeInTheDocument();
  });

  it('carries out a return to stock through the generic work-order call', async () => {
    const repossess = holderChange({
      name: 'WO-BACK',
      action: 'Repossess',
      operation_code: 'device.repossess',
      display_status: 'Ready',
      requested_holder_requested_client_user: null,
      primary_action: { operation_code: 'device.repossess', label: 'Return to stock', enabled: true },
      prerequisite_action: null,
      dependency_label: null,
    });
    vi.mocked(internal.executeWorkOrders).mockResolvedValue({
      results: [{ work_order: 'WO-BACK', ok: true, message: null }],
      completed: 1,
      skipped: 0,
      failed: 0,
      plan: plan({ action_groups: [actionGroup([repossess])] }),
    });
    await renderPage(request(), plan({ action_groups: [actionGroup([repossess], { label: 'Return to stock' })] }));
    await pickView('Return to stock');

    const row = await waitFor(() => rowOf('WO-BACK'));
    expect(await openedLabels(row)).not.toContain('Return to stock');
    fireEvent.click(within(row).getByRole('button', { name: 'Return to stock' }));
    await confirmDate('Return to stock');

    await waitFor(() =>
      expect(internal.executeWorkOrders).toHaveBeenCalledWith({
        request: 'SR-0001',
        executions: [dated('WO-BACK')],
      })
    );
  });

  it('runs exactly the ready work orders and shows each failure in its own row', async () => {
    const readyCards = Array.from({ length: 12 }, (_, index) => readyFor(index + 1));
    const waiting = Array.from({ length: 8 }, (_, index) => needsUsername(index + 13));
    const after = plan({
      action_groups: [
        actionGroup([
          ...readyCards.map((row) =>
            row.name === 'WO-05'
              ? { ...row, display_status: 'Failed' as const }
              : {
                  ...row,
                  display_status: 'Completed' as const,
                  primary_action: { ...row.primary_action, enabled: false },
                }
          ),
          ...waiting,
        ]),
      ],
    });
    vi.mocked(internal.executeWorkOrders).mockResolvedValue({
      results: readyCards.map((row) =>
        row.name === 'WO-05'
          ? { work_order: row.name, ok: false, message: 'Person 5 is disabled and cannot be given a new service.' }
          : { work_order: row.name, ok: true, message: null }
      ),
      completed: 11,
      skipped: 0,
      failed: 1,
      plan: after,
    });
    await renderPage(request(), plan({ action_groups: [actionGroup([...readyCards, ...waiting])] }));
    await pickView('Add Microsoft 365');

    expect(await screen.findByRole('button', { name: 'Complete 8 usernames' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Execute 12 ready' }));
    await confirmDate('Execute 12 ready');

    await waitFor(() => expect(internal.executeWorkOrders).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeWorkOrders).mock.calls[0][0]).toEqual({
      request: 'SR-0001',
      executions: readyCards.map((row) => dated(row.name)),
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('11 completed · 1 failed')).toBeInTheDocument();
    expect(
      within(rowOf('WO-05')).getByText('Person 5 is disabled and cannot be given a new service.')
    ).toBeInTheDocument();
    expect(within(rowOf('WO-04')).getByText('Completed')).toBeInTheDocument();
    expect(within(rowOf('WO-04')).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete 8 usernames' })).toBeInTheDocument();
  });

  it('saves the usernames it can, keeps a conflicting row local, and the saved ones become ready', async () => {
    const waiting = Array.from({ length: 8 }, (_, index) => needsUsername(index + 1));
    const saved = ['WO-01', 'WO-02', 'WO-03'];
    const refreshed = plan({
      action_groups: [
        actionGroup(
          waiting.map((row) =>
            saved.includes(row.name)
              ? {
                  ...row,
                  display_status: 'Ready' as const,
                  primary_action: { ...row.primary_action, enabled: true },
                  prerequisite_action: null,
                  dependency_label: null,
                  requirements: [],
                }
              : row
          )
        ),
      ],
    });
    vi.mocked(internal.saveRequiredIdentifiers).mockResolvedValue({
      results: [
        { owner: 'CU-1', kind: 'username', ok: true, message: null, code: null },
        { owner: 'CU-2', kind: 'username', ok: true, message: null, code: null },
        { owner: 'CU-3', kind: 'username', ok: true, message: null, code: null },
        { owner: 'CU-4', kind: 'username', ok: false, message: 'This username is already used by Paul Ebong.', code: 'CONFLICT' },
      ],
      saved: 3,
      failed: 1,
      plan: refreshed,
    });
    await renderPage(request(), plan({ action_groups: [actionGroup(waiting)] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Complete 8 usernames' }));
    const dialog = await screen.findByRole('dialog');
    for (const index of [1, 2, 3, 4]) {
      fireEvent.change(within(dialog).getByRole('textbox', { name: `Username for Person ${index}` }), {
        target: { value: `person.${index}` },
      });
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));

    await waitFor(() => expect(internal.saveRequiredIdentifiers).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.saveRequiredIdentifiers).mock.calls[0][0].values.map((row) => row.owner)).toEqual([
      'CU-1',
      'CU-2',
      'CU-3',
      'CU-4',
    ]);
    expect(
      vi.mocked(internal.saveRequiredIdentifiers).mock.calls[0][0].values.map((row) => row.owner_type)
    ).toEqual(['MSP Client User', 'MSP Client User', 'MSP Client User', 'MSP Client User']);
    expect(await within(dialog).findByText('This username is already used by Paul Ebong.')).toBeInTheDocument();
    expect(within(dialog).getAllByText('SAVED')).toHaveLength(3);
    expect(within(dialog).getByRole('textbox', { name: 'Username for Person 1' })).toHaveValue('person.1');
    expect(within(dialog).getByRole('textbox', { name: 'Username for Person 4' })).toHaveValue('person.4');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Execute 3 ready' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete 5 usernames' })).toBeInTheDocument();
    expect(screen.getByText('3 ready')).toBeInTheDocument();
    expect(screen.getByText('5 need information')).toBeInTheDocument();
  });

  it('keeps the rail compact: Action groups collapse, a group previews its targets, a future person reads NEW', async () => {
    const many = Array.from({ length: 8 }, (_, index) => readyFor(index + 1));
    const holder = holderChange();
    await renderPage(
      request(),
      plan({
        action_groups: [
          actionGroup(many),
          actionGroup([holder], { group_key: 'grp-holder', operation_code: 'device.transfer', label: 'Change holder', scope_label: 'ACI-LT-023' }),
        ],
        requested_entities: [marie()],
        people: [
          person('user:CU-1', 'Person 1', { remaining: 0 }),
          person('new:marie', 'Marie Dupont', { is_new: true, client_user: null, requested_client_user: 'RCU-1', department: 'Purchasing', remaining: 2 }),
        ],
      })
    );

    const rail = await screen.findByRole('complementary', { name: 'Execution view' });
    const groups = within(rail).getByRole('list', { name: 'Action groups' });
    expect(within(groups).getByText('All remaining work')).toBeInTheDocument();
    expect(within(groups).getByText('8 remaining · 0 completed')).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole('button', { name: 'Expand Add Microsoft 365' }));
    const preview = within(rail).getByRole('list', { name: 'Targets of Add Microsoft 365' });
    expect(within(preview).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Person 1 · Accounting',
      'Person 2 · Accounting',
      'Person 3 · Accounting',
      'Person 4 · Accounting',
      'Person 5 · Accounting',
      'Person 6 · Accounting',
      '+ 2 more',
    ]);

    fireEvent.click(within(rail).getByRole('button', { name: 'Expand Change holder' }));
    const holderPreview = within(rail).getByRole('list', { name: 'Targets of Change holder' });
    expect(within(holderPreview).getByRole('listitem')).toHaveTextContent(
      'ACI-LT-023 · Franck Mbassi → Marie Dupont'
    );

    fireEvent.click(within(rail).getByRole('button', { name: 'Collapse action groups' }));
    expect(within(rail).queryByRole('list', { name: 'Action groups' })).not.toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Expand action groups' })).toHaveAttribute('aria-expanded', 'false');

    const people = within(rail).getByRole('list', { name: 'People' });
    const future = within(people).getByText('Marie Dupont').closest('button') as HTMLElement;
    expect(within(future).getByText('NEW')).toBeInTheDocument();
    expect(within(future).getByText('3 items remaining')).toBeInTheDocument();
    expect(within(people).getByText('Done')).toBeInTheDocument();
    expect(within(people).getByText('Person 1').closest('button')).not.toHaveTextContent('NEW');
  });

  it('opens a future person on their own creation, even when their work sits under somebody else', async () => {
    const holder = holderChange();
    await renderPage(
      request(),
      plan({
        action_groups: [
          actionGroup([holder], { group_key: 'grp-holder', operation_code: 'device.transfer', label: 'Change holder', scope_label: 'ACI-LT-023' }),
        ],
        requested_entities: [marie()],
        people: [
          person('user:CU-7', 'Franck Mbassi', { remaining: 1 }),
          person('new:marie', 'Marie Dupont', { is_new: true, client_user: null, requested_client_user: 'RCU-1', remaining: 0 }),
        ],
      })
    );

    const rail = await screen.findByRole('complementary', { name: 'Execution view' });
    fireEvent.click(within(within(rail).getByRole('list', { name: 'People' })).getByText('Marie Dupont'));

    const table = within(screen.getByRole('region', { name: 'Execution workspace' })).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Marie Dupont')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'Create user' })).toBeEnabled();
    expect(within(rows[1]).getByText('Waits for Marie Dupont')).toBeInTheDocument();
  });

  it('reads the work of one person when that person is chosen', async () => {
    const holder = holderChange({ subject_key: 'new:marie' });
    await renderPage(
      request(),
      plan({
        action_groups: [
          actionGroup([readyFor(1)]),
          actionGroup([holder], { group_key: 'grp-holder', label: 'Change holder', scope_label: 'ACI-LT-023' }),
        ],
        requested_entities: [marie()],
        people: [
          person('user:CU-1', 'Person 1'),
          person('new:marie', 'Marie Dupont', { is_new: true, department: 'Purchasing' }),
        ],
      })
    );

    const rail = await screen.findByRole('complementary', { name: 'Execution view' });
    fireEvent.click(within(within(rail).getByRole('list', { name: 'People' })).getByText('Marie Dupont'));

    const workspace = screen.getByRole('region', { name: 'Execution workspace' });
    expect(within(workspace).getByRole('heading', { name: 'Marie Dupont' })).toBeInTheDocument();
    expect(within(workspace).getByText('Purchasing · all accepted work involving this person')).toBeInTheDocument();
    expect(rowOf('WO-HOLD')).toBeInTheDocument();
    expect(rowOf('WO-01')).toBeNull();
  });

  it('shows no preparation summary and no guidance sentences: the Create user row opens the preparation', async () => {
    await renderPage(
      request(),
      plan({
        action_groups: [actionGroup([holderChange()], { label: 'Change holder' })],
        requested_entities: [marie()],
        preparation: { new_people: 1, unresolved_devices: 1, missing_usernames: 4, missing_serials: 1 },
      })
    );
    await pickView('Change holder');

    await waitFor(() => expect(entityRowOf('RCU-1')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Preparation' })).not.toBeInTheDocument();
    for (const label of ['New people', 'Unresolved Devices', 'Missing usernames', 'Missing serials']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Open preparation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Prepare \d+ prerequisite/ })).not.toBeInTheDocument();
    for (const sentence of [
      'Complete accepted work. The requested action remains the primary action on each row.',
      'Work by Action Group or by person.',
      'Ready work can run independently of unrelated missing data.',
      'You can leave this Request and return later. Persisted work and prepared data remain saved.',
      'Progress is saved as work is completed.',
    ]) {
      expect(screen.queryByText(sentence)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('region', { name: 'Grouped execution' })).not.toBeInTheDocument();

    fireEvent.click(within(entityRowOf('RCU-1')).getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText('Prepare requested Client User')).toBeInTheDocument();
  });

  const kanto = (overrides: Partial<RequestedEntityPresentation> = {}) =>
    marie({
      name: 'RCU-K',
      key: 'new:kanto',
      display_name: 'Kanto',
      context_label: 'Requested Client User · Sales',
      requested_snapshot: { full_name: 'Kanto', department: 'Sales' },
      ...overrides,
    });
  const pcKanto = (overrides: Partial<RequestedEntityPresentation> = {}): RequestedEntityPresentation => ({
    kind: 'device',
    name: 'RDEV-K',
    key: 'new-device:kanto',
    display_name: 'PC-KANTO',
    context_label: 'Requested Device · Laptop',
    status: 'Open',
    readiness: 'needs_information',
    badge: 'NEEDS INFORMATION',
    resolved_to: null,
    requested_snapshot: { device_type: 'Laptop', hostname: 'PC-KANTO' },
    prepared_values: {},
    requested_work_count: 1,
    relationship_summary: [],
    ...overrides,
  });
  const assignKanto = (overrides: Partial<WorkCard> = {}) =>
    card({
      name: 'WO-ASSIGN',
      work_type: 'Device Operation',
      action: 'Assign',
      operation_code: 'device.assign',
      action_group_key: 'grp-assign',
      target_scope: 'Device',
      subject_key: 'new:kanto',
      client_user: null,
      requested_client_user: 'RCU-K',
      requested_device: 'RDEV-K',
      display_status: 'Waiting for prerequisite',
      ready: false,
      target: {
        kind: 'requested_device',
        name: null,
        requested_entity: 'RDEV-K',
        label: 'PC-KANTO',
        sublabel: 'for Kanto',
        badge: 'UNRESOLVED',
      },
      primary_action: { operation_code: 'device.assign', label: 'Assign device', enabled: false },
      prerequisite_action: { kind: 'prepare_device', label: 'Prepare Device', requested_entity: 'RDEV-K' },
      dependency_label: 'Requested Device must be resolved',
      ...overrides,
    });
  const kantoPlan = (work: WorkCard, entities: RequestedEntityPresentation[]) =>
    plan({
      action_groups: [
        actionGroup([work], { group_key: 'grp-assign', operation_code: 'device.assign', label: 'Assign device' }),
      ],
      requested_entities: entities,
      people: [
        person('new:kanto', 'Kanto', {
          is_new: true,
          client_user: null,
          requested_client_user: 'RCU-K',
          department: 'Sales',
          remaining: 1,
        }),
      ],
    });
  const tableRows = () =>
    within(screen.getByRole('region', { name: 'Execution workspace' }))
      .getAllByRole('row')
      .slice(1);

  it('starts with creating the user: Create user, then Prepare Device, then the act waiting for both', async () => {
    await renderPage(request(), kantoPlan(assignKanto(), [kanto(), pcKanto()]));

    await waitFor(() => expect(rowOf('WO-ASSIGN')).toBeInTheDocument());
    const rows = tableRows();
    expect(rows.map((row) => row.querySelectorAll('td')[1].querySelector('p')?.textContent)).toEqual([
      'Create user',
      'Prepare Device',
      'Assign device',
    ]);
    expect(rows[0]).toHaveTextContent('Kanto');
    expect(within(rows[0]).getByText('NEW')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Sales')).toBeInTheDocument();
    expect(within(rows[0]).getByText('To do')).toBeInTheDocument();
    expect(within(rows[1]).getByText('PC-KANTO')).toBeInTheDocument();
    expect(within(rows[1]).getByText('UNRESOLVED')).toBeInTheDocument();
    for (const [row, label] of [
      [rows[0], 'Create user'],
      [rows[1], 'Prepare Device'],
    ] as const) {
      const buttons = within(row).getAllByRole('button');
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toHaveAccessibleName(label);
      expect(buttons[0]).toBeEnabled();
      expect(buttons[1]).toHaveAccessibleName('More options');
    }
    expect(within(rows[2]).getByRole('button', { name: 'Assign device' })).toBeDisabled();
    expect(within(rows[2]).getByText('Waits for Kanto and PC-KANTO')).toBeInTheDocument();
    expect(within(rows[2]).queryByRole('button', { name: /^Prepare/ })).not.toBeInTheDocument();

    const rail = screen.getByRole('complementary', { name: 'Execution view' });
    const entry = within(within(rail).getByRole('list', { name: 'People' })).getByText('Kanto').closest('button') as HTMLElement;
    expect(within(entry).getByText('3 items remaining')).toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Prepare Device' }));
    expect(await screen.findByText('Prepare requested Device')).toBeInTheDocument();
  });

  it('holds a machine intended for a person still to create: Prepare Device disabled, Waiting, Waits for Kanto', async () => {
    const intended = pcKanto({ intended_holder_requested_client_user: 'RCU-K', blocked_by: { name: 'RCU-K', label: 'Kanto' } });
    await renderPage(request(), kantoPlan(assignKanto(), [kanto(), intended]));

    await waitFor(() => expect(entityRowOf('RDEV-K')).toBeInTheDocument());
    const machine = entityRowOf('RDEV-K');
    expect(within(machine).getByRole('button', { name: 'Prepare Device' })).toBeDisabled();
    expect(within(machine).getByText('Waiting')).toBeInTheDocument();
    expect(within(machine).queryByText('To do')).not.toBeInTheDocument();
    expect(within(machine).getByText('Waits for Kanto')).toBeInTheDocument();
    expect(within(entityRowOf('RCU-K')).getByRole('button', { name: 'Create user' })).toBeEnabled();
  });

  it('frees the machine once the plan says its person is resolved', async () => {
    const created = kanto({
      status: 'Resolved',
      readiness: 'resolved',
      resolved_to: { doctype: 'MSP Client User', name: 'CU-1054', label: 'Kanto', mode: 'Create New' },
    });
    const intended = pcKanto({ intended_holder_requested_client_user: 'RCU-K', blocked_by: null });
    await renderPage(request(), kantoPlan(assignKanto(), [created, intended]));

    await waitFor(() => expect(entityRowOf('RDEV-K')).toBeInTheDocument());
    const machine = entityRowOf('RDEV-K');
    expect(within(machine).getByRole('button', { name: 'Prepare Device' })).toBeEnabled();
    expect(within(machine).getByText('To do')).toBeInTheDocument();
    expect(within(machine).queryByText('Waits for Kanto')).not.toBeInTheDocument();
  });

  it('never holds a machine that has no intended holder', async () => {
    const loose = pcKanto({ intended_holder_requested_client_user: null, blocked_by: null });
    await renderPage(request(), kantoPlan(assignKanto({ requested_client_user: null }), [loose]));

    await waitFor(() => expect(entityRowOf('RDEV-K')).toBeInTheDocument());
    const machine = entityRowOf('RDEV-K');
    expect(within(machine).getByRole('button', { name: 'Prepare Device' })).toBeEnabled();
    expect(within(machine).getByText('To do')).toBeInTheDocument();
    expect(within(machine).getByText('UNRESOLVED')).toBeInTheDocument();
    expect(within(machine).queryByText(/^Waits for/)).not.toBeInTheDocument();
  });

  it('shows a resolved person as Completed with the record and how, and the act then waits for the machine only', async () => {
    const created = kanto({
      status: 'Resolved',
      readiness: 'resolved',
      badge: 'RESOLVED',
      resolved_to: { doctype: 'MSP Client User', name: 'CU-1054', label: 'Kanto', mode: 'Create New' },
    });
    await renderPage(request(), kantoPlan(assignKanto(), [created, pcKanto()]));

    await waitFor(() => expect(rowOf('WO-ASSIGN')).toBeInTheDocument());
    const person = entityRowOf('RCU-K');
    expect(within(person).getByText('Completed')).toBeInTheDocument();
    expect(within(person).getByText('CU-1054 · Created during fulfilment')).toBeInTheDocument();
    expect(within(person).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rowOf('WO-ASSIGN')).getByText('Waits for PC-KANTO')).toBeInTheDocument();
    expect(within(rowOf('WO-ASSIGN')).getByRole('button', { name: 'Assign device' })).toBeDisabled();
  });

  it('enables the act once both the person and the machine are resolved', async () => {
    const created = kanto({
      status: 'Resolved',
      readiness: 'resolved',
      resolved_to: { doctype: 'MSP Client User', name: 'CU-1054', label: 'Kanto', mode: 'Use Existing' },
    });
    const registered = pcKanto({
      status: 'Resolved',
      readiness: 'resolved',
      resolved_to: { doctype: 'MSP Managed Device', name: 'DEV-90', label: 'PC-KANTO', mode: 'Register New' },
    });
    await renderPage(
      request(),
      kantoPlan(
        assignKanto({
          display_status: 'Ready',
          ready: true,
          prerequisite_action: null,
          dependency_label: null,
          primary_action: { operation_code: 'device.assign', label: 'Assign device', enabled: true },
        }),
        [created, registered]
      )
    );

    await waitFor(() => expect(rowOf('WO-ASSIGN')).toBeInTheDocument());
    expect(within(entityRowOf('RCU-K')).getByText('CU-1054 · Existing Client User selected')).toBeInTheDocument();
    expect(within(entityRowOf('RDEV-K')).getByText('DEV-90 · Registered during fulfilment')).toBeInTheDocument();
    expect(within(entityRowOf('RDEV-K')).queryByText('UNRESOLVED')).not.toBeInTheDocument();
    expect(within(entityRowOf('RCU-K')).getByText('NEW')).toBeInTheDocument();
    expect(within(rowOf('WO-ASSIGN')).getByRole('button', { name: 'Assign device' })).toBeEnabled();
    expect(within(rowOf('WO-ASSIGN')).queryByText(/^Waits for/)).not.toBeInTheDocument();
  });

  it('lists an entity two work rows depend on once, before the first of them', async () => {
    const waitingOn = (name: string) =>
      card({
        name,
        subject_key: 'new:marie',
        client_user: null,
        requested_client_user: 'RCU-1',
        display_status: 'Waiting for prerequisite',
        ready: false,
        primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
        prerequisite_action: { kind: 'prepare_person', label: 'Prepare person', requested_entity: 'RCU-1' },
      });
    await renderPage(
      request(),
      plan({ action_groups: [actionGroup([waitingOn('WO-A'), waitingOn('WO-B')])], requested_entities: [marie()] })
    );
    await pickView('All remaining work');

    await waitFor(() => expect(rowOf('WO-B')).toBeInTheDocument());
    expect(document.querySelectorAll('[data-requested-entity="RCU-1"]')).toHaveLength(1);
    expect(tableRows().map((row) => row.getAttribute('data-requested-entity') ?? row.getAttribute('data-work-order'))).toEqual([
      'RCU-1',
      'WO-A',
      'WO-B',
    ]);
    expect(within(await railEntry('All remaining work')).getByText('3')).toBeInTheDocument();
  });

  it('hides the grouped execution bar when there is nothing to execute or complete', async () => {
    await renderPage(
      request(),
      plan({
        action_groups: [
          actionGroup([
            card({
              display_status: 'Completed',
              ready: false,
              primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
            }),
          ]),
        ],
      })
    );

    await waitFor(() => expect(rowOf('WO-0001')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Grouped execution' })).not.toBeInTheDocument();
    expect(screen.queryByText('Grouped execution')).not.toBeInTheDocument();
  });

  it('lists the targets of the current view', async () => {
    await renderPage(request(), plan({ action_groups: [actionGroup([readyFor(1), needsUsername(2)])] }));

    fireEvent.click(await screen.findByRole('button', { name: 'View targets' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Targets in this view')).toBeInTheDocument();
    expect(within(dialog).getByText('1 Work Order target')).toBeInTheDocument();
    expect(within(dialog).getByText('Person 1')).toBeInTheDocument();
    expect(within(dialog).queryByText('Needs information')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await pickView('All remaining work');
    fireEvent.click(screen.getByRole('button', { name: 'View targets' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 Work Order targets')).toBeInTheDocument();
    expect(within(dialog).getByText('Needs information')).toBeInTheDocument();
  });
});

const done = (index: number): WorkCard => ({
  ...readyFor(index),
  display_status: 'Completed',
  primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
});

const vpnGroup = (work: WorkCard[]) =>
  actionGroup(
    work.map((row) => ({ ...row, action_group_key: 'grp-vpn' })),
    { group_key: 'grp-vpn', label: 'Add VPN', scope_label: 'All selected' }
  );

const threePeople = () =>
  plan({
    action_groups: [actionGroup([done(1), readyFor(2), readyFor(3)])],
    people: [
      person('user:CU-1', 'Person 1', { remaining: 0 }),
      person('user:CU-2', 'Person 2'),
      person('user:CU-3', 'Person 3'),
    ],
  });

const workspace = () => screen.getByRole('region', { name: 'Execution workspace' });

const workspaceHeader = () => screen.getByRole('button', { name: 'View targets' }).parentElement as HTMLElement;

const opensOn = async (entry: string, heading: string) => {
  await waitFor(async () => expect(await railEntry(entry)).toHaveAttribute('aria-current', 'true'));
  expect(within(workspace()).getByRole('heading', { name: heading })).toBeInTheDocument();
  const rail = await executionRail();
  expect(
    within(rail)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'true')
  ).toHaveLength(1);
};

describe('where the Execute step opens', () => {
  it('opens on the first person who still has work, skipping one whose work is done', async () => {
    await renderPage(request(), threePeople());

    await opensOn('Person 2', 'Person 2');
    expect(rowOf('WO-02')).toBeInTheDocument();
    expect(rowOf('WO-01')).toBeNull();
    expect(rowOf('WO-03')).toBeNull();
    expect(await railEntry('Person 1')).not.toHaveAttribute('aria-current');
    expect(await railEntry('All remaining work')).not.toHaveAttribute('aria-current');
  });

  it('opens on the first person when nobody has work left', async () => {
    await renderPage(
      request(),
      plan({
        action_groups: [actionGroup([done(1), done(2)])],
        people: [person('user:CU-1', 'Person 1', { remaining: 0 }), person('user:CU-2', 'Person 2', { remaining: 0 })],
      })
    );

    await opensOn('Person 1', 'Person 1');
    expect(rowOf('WO-01')).toBeInTheDocument();
    expect(rowOf('WO-02')).toBeNull();
  });

  it('falls back to the first action group with work when the plan has no person', async () => {
    await renderPage(
      request(),
      plan({ action_groups: [actionGroup([done(1)]), vpnGroup([readyFor(2)])], people: [] })
    );

    await opensOn('Add VPN', 'Add VPN');
    expect(within(workspace()).getByText('All selected · 1 target')).toBeInTheDocument();
    expect(rowOf('WO-02')).toBeInTheDocument();
    expect(rowOf('WO-01')).toBeNull();
  });

  it('remembers the view picked for this request, and only for this request', async () => {
    await renderPage(request(), threePeople());
    await opensOn('Person 2', 'Person 2');

    await pickView('Person 3');
    await opensOn('Person 3', 'Person 3');
    expect(JSON.parse(window.localStorage.getItem('msp.request.execution.SR-0001') as string)).toEqual({
      kind: 'person',
      key: 'user:CU-3',
    });
    cleanup();

    await renderPage(request(), threePeople());
    await opensOn('Person 3', 'Person 3');
    expect(rowOf('WO-03')).toBeInTheDocument();
    cleanup();

    window.localStorage.clear();
    window.localStorage.setItem(
      'msp.request.execution.SR-0002',
      JSON.stringify({ kind: 'group', key: 'grp-m365' })
    );
    await renderPage(request(), threePeople());
    await opensOn('Person 2', 'Person 2');
  });

  it('restores a remembered action group of this request', async () => {
    window.localStorage.setItem(
      'msp.request.execution.SR-0001',
      JSON.stringify({ kind: 'group', key: 'grp-m365' })
    );
    await renderPage(request(), threePeople());

    await opensOn('Add Microsoft 365', 'Add Microsoft 365');
    for (const order of ['WO-01', 'WO-02', 'WO-03']) expect(rowOf(order)).toBeInTheDocument();
  });

  it('ignores a remembered action group that no longer exists', async () => {
    window.localStorage.setItem(
      'msp.request.execution.SR-0001',
      JSON.stringify({ kind: 'group', key: 'grp-gone' })
    );
    await renderPage(request(), threePeople());

    await opensOn('Person 2', 'Person 2');
  });

  it('changes nothing when the browser storage throws', async () => {
    window.localStorage.setItem(
      'msp.request.execution.SR-0001',
      JSON.stringify({ kind: 'person', key: 'user:CU-3' })
    );
    const reading = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is disabled.');
    });
    const writing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage is disabled.');
    });

    try {
      await renderPage(request(), threePeople());
      await opensOn('Person 2', 'Person 2');
      expect(reading).toHaveBeenCalledWith('msp.request.execution.SR-0001');

      await pickView('All remaining work');
      expect(writing).toHaveBeenCalled();
      await opensOn('All remaining work', 'All remaining work');
    } finally {
      reading.mockRestore();
      writing.mockRestore();
    }
  });
});

describe('the header of the Execute workspace', () => {
  const pageMenu = (overrides: Partial<Parameters<typeof buildClientUserRowActions>[0]>) =>
    visibleLabels(
      buildClientUserRowActions({
        lifecycleStatus: 'Active',
        canWrite: true,
        hasOpenPersonalServices: true,
        devices: [],
        onAddService: noop,
        onAssignDevice: noop,
        onAddServiceOnDevice: noop,
        onReturnDeviceToStock: noop,
        onEdit: noop,
        onChangeStatus: noop,
        onStopAllServices: noop,
        ...overrides,
      })
    );

  it('puts the person menu next to View targets, exactly as the person page builds it', async () => {
    await renderPage(request({ people: { 'CU-1': facts() } } as never), plan());
    await opensOn('John Doe', 'John Doe');

    const labels = await openedLabels(workspaceHeader());
    const expected = pageMenu({ devices: [{ name: 'DEV-1', label: 'KV-JDOE' }] });
    expect(labels).toEqual(expected);
    expect(labels).toContain('Add service');
    expect(labels).toContain('Return KV-JDOE to stock');
  });

  it('builds that menu from the facts of the person shown', async () => {
    await renderPage(
      request({
        people: { 'CU-1': facts({ lifecycle_status: 'Disabled', devices: [], services: [] }) },
      } as never),
      plan()
    );
    await opensOn('John Doe', 'John Doe');

    const labels = await openedLabels(workspaceHeader());
    expect(labels).toEqual(pageMenu({ lifecycleStatus: 'Disabled', hasOpenPersonalServices: false }));
    expect(labels).toEqual(['Edit', 'Reactivate user']);
  });

  it('shows no person menu when a group or all the work is shown', async () => {
    await renderPage(request({ people: { 'CU-1': facts() } } as never), plan());
    await opensOn('John Doe', 'John Doe');
    expect(within(workspaceHeader()).getByTitle('More options')).toBeInTheDocument();

    await pickView('Add Microsoft 365');
    await opensOn('Add Microsoft 365', 'Add Microsoft 365');
    expect(within(workspaceHeader()).queryByTitle('More options')).not.toBeInTheDocument();
    expect(within(workspaceHeader()).queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();

    await pickView('All remaining work');
    await opensOn('All remaining work', 'All remaining work');
    expect(within(workspaceHeader()).queryByTitle('More options')).not.toBeInTheDocument();
  });

  it('keeps the menu of a person still requested in place, disabled, with its explanation', async () => {
    const pending = card({
      name: 'WO-MARIE',
      subject_key: 'new:marie',
      client_user: null,
      requested_client_user: 'RCU-1',
      display_status: 'Waiting for prerequisite',
      target: {
        kind: 'requested_client_user',
        name: null,
        requested_entity: 'RCU-1',
        label: 'Marie Dupont',
        sublabel: 'Purchasing',
        badge: 'NEW',
      },
      primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
      prerequisite_action: { kind: 'prepare_person', label: 'Prepare person', requested_entity: 'RCU-1' },
      dependency_label: 'Requested Client User must be resolved',
    });
    await renderPage(
      request(),
      plan({
        action_groups: [actionGroup([pending])],
        requested_entities: [marie()],
        people: [person('new:marie', 'Marie Dupont', { is_new: true, client_user: null, requested_client_user: 'RCU-1' })],
      })
    );
    await opensOn('Marie Dupont', 'Marie Dupont');

    const more = within(workspaceHeader()).getByRole('button', { name: 'More options' });
    expect(more).toBeDisabled();
    expect(more).toHaveAccessibleDescription(
      'Resolve this requested target before using its standard detail actions.'
    );
    fireEvent.click(more);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('the Action groups section of the rail', () => {
  it('folds and unfolds with its icon button, named for what it does', async () => {
    await renderPage(request(), plan());
    const rail = await executionRail();

    const collapse = within(rail).getByRole('button', { name: 'Collapse action groups' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse).toHaveTextContent(/^$/);
    expect(collapse.querySelector('svg')).not.toBeNull();
    expect(within(rail).getByRole('list', { name: 'Action groups' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();

    fireEvent.click(collapse);
    expect(within(rail).queryByRole('list', { name: 'Action groups' })).not.toBeInTheDocument();
    expect(within(rail).queryByText('All remaining work')).not.toBeInTheDocument();
    const expand = within(rail).getByRole('button', { name: 'Expand action groups' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(within(rail).queryByRole('button', { name: 'Collapse action groups' })).not.toBeInTheDocument();
    expect(within(rail).getByRole('list', { name: 'People' })).toBeInTheDocument();

    fireEvent.click(expand);
    expect(within(rail).getByRole('list', { name: 'Action groups' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Collapse action groups' })).toHaveAttribute('aria-expanded', 'true');
  });
});

const onDate = (index: number, effectiveDate: string | null, current: WorkCard['current'] = null): WorkCard => ({
  ...readyFor(index),
  effective_date: effectiveDate,
  current,
});

const invoicedTo = (billedTo: string | null): WorkCard['current'] => ({
  name: 'SA-9',
  operational_status: 'Active',
  quantity: 1,
  effective_start_date: '2026-01-01',
  effective_end_date: null,
  billed_to: billedTo,
});

const executedAs = (...cards: WorkCard[]) => ({
  results: cards.map((row) => ({ work_order: row.name, ok: true, message: null })),
  completed: cards.length,
  skipped: 0,
  failed: 0,
  plan: plan({ action_groups: [actionGroup(cards)] }),
});

const localToday = () => {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
};

const INVOICED = 'This period has already been invoiced.';
const MIXED = 'These work orders were requested for different dates. The date below applies to all of them.';

describe('the effective date is asked before any work is carried out', () => {
  it('asks it for one row, prefilled with the row date, and sends exactly that work order with it', async () => {
    let answer: (value: Awaited<ReturnType<typeof internal.executeWorkOrders>>) => void = noop;
    vi.mocked(internal.executeWorkOrders).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const row = onDate(1, '2026-09-20');
    await renderPage(request(), plan({ action_groups: [actionGroup([row])], people: [person('user:CU-1', 'Person 1')] }));

    fireEvent.click(within(await waitFor(() => rowOf('WO-01'))).getByRole('button', { name: 'Add service' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add service' })).toBeInTheDocument();
    expect(within(dialog).getByText('Person 1')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Effective date')).toHaveValue('2026-09-20');
    expect(within(dialog).getByText('Billing counts from this date.')).toBeInTheDocument();
    expect(within(dialog).queryByText(MIXED)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(INVOICED)).not.toBeInTheDocument();
    expect(internal.executeWorkOrders).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole('button', { name: 'Add service' });
    fireEvent.click(confirm);

    await waitFor(() => expect(internal.executeWorkOrders).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeWorkOrders).mock.calls[0][0]).toEqual({
      request: 'SR-0001',
      executions: [{ work_order: 'WO-01', inputs: { effective_date: '2026-09-20' } }],
    });
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    answer(executedAs(row));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sends the date changed for one row, and cannot confirm without a date', async () => {
    const row = onDate(1, '2026-09-20');
    vi.mocked(internal.executeWorkOrders).mockResolvedValue(executedAs(row));
    await renderPage(request(), plan({ action_groups: [actionGroup([row])], people: [person('user:CU-1', 'Person 1')] }));

    fireEvent.click(within(await waitFor(() => rowOf('WO-01'))).getByRole('button', { name: 'Add service' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Effective date');
    const confirm = within(dialog).getByRole('button', { name: 'Add service' });

    fireEvent.change(field, { target: { value: '' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(field, { target: { value: '2026-10-03' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(internal.executeWorkOrders).toHaveBeenCalledWith({
        request: 'SR-0001',
        executions: [{ work_order: 'WO-01', inputs: { effective_date: '2026-10-03' } }],
      })
    );
  });

  it('prefills a group with the date its rows share and sends every work order with it', async () => {
    const rows = [1, 2, 3].map((index) => onDate(index, '2026-09-20'));
    vi.mocked(internal.executeWorkOrders).mockResolvedValue(executedAs(...rows));
    await renderPage(request(), plan({ action_groups: [actionGroup(rows)] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Execute 3 ready' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Execute 3 ready' })).toBeInTheDocument();
    expect(within(dialog).getByText('3 work orders')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Effective date')).toHaveValue('2026-09-20');
    expect(within(dialog).queryByText(MIXED)).not.toBeInTheDocument();
    expect(internal.executeWorkOrders).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Execute 3 ready' }));

    await waitFor(() => expect(internal.executeWorkOrders).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeWorkOrders).mock.calls[0][0]).toEqual({
      request: 'SR-0001',
      executions: ['WO-01', 'WO-02', 'WO-03'].map((name) => ({
        work_order: name,
        inputs: { effective_date: '2026-09-20' },
      })),
    });
    expect(await screen.findByText('3 completed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when a group was requested for different dates, opens on the requested date, and sends the one chosen', async () => {
    const rows = [onDate(1, '2026-09-20'), onDate(2, '2026-09-22'), onDate(3, '2026-09-20')];
    vi.mocked(internal.executeWorkOrders).mockResolvedValue(executedAs(...rows));
    await renderPage(request(), plan({ action_groups: [actionGroup(rows)] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Execute 3 ready' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(MIXED)).toBeInTheDocument();
    const field = within(dialog).getByLabelText('Effective date');
    expect(field).toHaveValue('2026-09-15');

    fireEvent.change(field, { target: { value: '2026-10-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Execute 3 ready' }));

    await waitFor(() => expect(internal.executeWorkOrders).toHaveBeenCalledTimes(1));
    expect(
      vi.mocked(internal.executeWorkOrders).mock.calls[0][0].executions.map((row) => row.inputs)
    ).toEqual([
      { effective_date: '2026-10-01' },
      { effective_date: '2026-10-01' },
      { effective_date: '2026-10-01' },
    ]);
  });

  it('opens on the requested date when a row carries none', async () => {
    await renderPage(request(), plan({ action_groups: [actionGroup([onDate(1, null)])], people: [person('user:CU-1', 'Person 1')] }));

    fireEvent.click(within(await waitFor(() => rowOf('WO-01'))).getByRole('button', { name: 'Add service' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText('Effective date')).toHaveValue('2026-09-15');
  });

  it('reads a row without a date as requested for the date of the request, with no notice', async () => {
    const rows = [onDate(1, '2026-09-15'), onDate(2, null), onDate(3, '2026-09-15')];
    vi.mocked(internal.executeWorkOrders).mockResolvedValue(executedAs(...rows));
    await renderPage(request(), plan({ action_groups: [actionGroup(rows)] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Execute 3 ready' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(MIXED)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Effective date')).toHaveValue('2026-09-15');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Execute 3 ready' }));

    await waitFor(() => expect(internal.executeWorkOrders).toHaveBeenCalledTimes(1));
    expect(
      vi.mocked(internal.executeWorkOrders).mock.calls[0][0].executions.map((row) => row.inputs)
    ).toEqual([
      { effective_date: '2026-09-15' },
      { effective_date: '2026-09-15' },
      { effective_date: '2026-09-15' },
    ]);
  });

  it('still says so when a row without a date sits beside a row requested for another date', async () => {
    const rows = [onDate(1, '2026-09-22'), onDate(2, null)];
    await renderPage(request(), plan({ action_groups: [actionGroup(rows)] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Execute 2 ready' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(MIXED)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Effective date')).toHaveValue('2026-09-15');
  });

  it('opens on today when neither the rows nor the request carry a date', async () => {
    const base = plan();
    await renderPage(
      request(),
      plan({
        context: { ...base.context, requested_date: null },
        action_groups: [actionGroup([onDate(1, null), onDate(2, null)])],
      })
    );
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Execute 2 ready' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Effective date')).toHaveValue(localToday());
    expect(within(dialog).queryByText(MIXED)).not.toBeInTheDocument();
  });

  it('warns about an invoiced period and confirms it for that row only', async () => {
    const billed = onDate(1, '2026-09-20', invoicedTo('2026-09-30'));
    const open = onDate(2, '2026-09-20', invoicedTo('2026-08-31'));
    vi.mocked(internal.executeWorkOrders).mockResolvedValue(executedAs(billed, open));
    await renderPage(request(), plan({ action_groups: [actionGroup([billed, open])] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(await screen.findByRole('button', { name: 'Execute 2 ready' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Effective date');
    expect(within(dialog).getByText(INVOICED)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The work can still be carried out on this date. The existing invoice is not changed: handle any financial adjustment separately.'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Already invoiced: Person 1')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '2026-10-01' } });
    expect(within(dialog).queryByText(INVOICED)).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: '2026-09-30' } });
    expect(within(dialog).getByText(INVOICED)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Execute 2 ready' }));

    await waitFor(() => expect(internal.executeWorkOrders).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.executeWorkOrders).mock.calls[0][0].executions).toEqual([
      { work_order: 'WO-01', inputs: { effective_date: '2026-09-30', confirm_billed: 1 } },
      { work_order: 'WO-02', inputs: { effective_date: '2026-09-30' } },
    ]);
  });

  it('sends nothing when the date is cancelled, for a row or for a group', async () => {
    await renderPage(request(), plan({ action_groups: [actionGroup([onDate(1, '2026-09-20'), onDate(2, '2026-09-20')])] }));
    await pickView('Add Microsoft 365');

    fireEvent.click(within(await waitFor(() => rowOf('WO-01'))).getByRole('button', { name: 'Add service' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Execute 2 ready' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(internal.executeWorkOrders).not.toHaveBeenCalled();
    expect(within(rowOf('WO-01')).getByRole('button', { name: 'Add service' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('step 3 — verify', () => {
  it('reads the same entries by action and by person', async () => {
    const work = executed({
      recap: executed().recap.map((entry) =>
        entry.kind === 'requested' ? { ...entry, action_group_key: 'grp-m365' } : entry
      ),
      requested_entities: [
        marie({
          status: 'Resolved',
          readiness: 'resolved',
          badge: 'RESOLVED',
          resolved_to: { doctype: 'MSP Client User', name: 'CU-1054', label: 'Marie Dupont', mode: 'Create New' },
        }),
      ],
    });
    await renderPage(request(), work);

    expect(await screen.findByRole('heading', { name: 'Execution recap' })).toBeInTheDocument();
    expect(screen.getByText('Review what was actually performed before final validation.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    for (const label of ['Completed requested work', 'Unresolved', 'Additional actions', 'Requested entities resolved']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const byAction = screen.getByRole('region', { name: 'Add Microsoft 365' });
    expect(within(byAction).getByText('John Doe')).toBeInTheDocument();
    expect(within(byAction).getByText('REQUESTED')).toBeInTheDocument();
    const extra = screen.getByRole('region', { name: 'Additional technician work' });
    expect(within(extra).getByText('VPN · Grant a service')).toBeInTheDocument();
    expect(within(extra).getByText('Needed for remote work')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Requested entities' })).getByText('RESOLVED')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'By person' }));
    const byPerson = screen.getByRole('region', { name: 'John Doe' });
    expect(within(byPerson).getByText('Microsoft 365 · Grant a service')).toBeInTheDocument();
    expect(within(byPerson).getByText('VPN · Grant a service')).toBeInTheDocument();
    expect(within(byPerson).getByText('REQUESTED')).toBeInTheDocument();
    expect(within(byPerson).getByText('ADDITIONAL ACTION')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Add Microsoft 365' })).not.toBeInTheDocument();
  });
});

describe('step 3 — a resolution is read once, on its Requested entity', () => {
  it('names the machine chosen for a requested Device on the entity, never as a person of its own', async () => {
    const work = executed({
      recap: [
        ...executed().recap,
        {
          work_order: 'RDEV-0001',
          subject_key: null,
          subject: null,
          department: null,
          kind: 'object',
          title: 'Existing Device selected',
          detail: 'ACI-LT-087 · SN-087',
          reason: null,
          at: '2026-09-13 10:10:00',
          by: 'Tech One',
        },
      ],
      requested_entities: [
        marie({
          kind: 'device',
          name: 'RDEV-0001',
          key: 'new-device:1',
          display_name: 'New laptop',
          context_label: 'Requested Device · Laptop',
          status: 'Resolved',
          readiness: 'resolved',
          badge: 'RESOLVED',
          resolved_to: { doctype: 'MSP Managed Device', name: 'DEV-87', label: 'ACI-LT-087', mode: 'Use Existing' },
        }),
      ],
    });
    await renderPage(request(), work);

    const entities = await screen.findByRole('region', { name: 'Requested entities' });
    expect(within(entities).getByText('New laptop')).toBeInTheDocument();
    expect(within(entities).getByText(/Requested Device · Laptop · ACI-LT-087 · Existing Device selected/)).toBeInTheDocument();
    expect(within(entities).getAllByText('RESOLVED')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'By person' }));
    expect(screen.getByRole('region', { name: 'John Doe' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Existing Device selected' })).not.toBeInTheDocument();
  });
});

describe('step 3 — verify reads the server figures', () => {
  it('shows the outcome the server computed even when the rows would add up differently', async () => {
    await renderPage(
      request(),
      executed({
        outcome: {
          ...executed().outcome,
          requested_done: 5,
          unresolved_accepted: 3,
          technician_done: 4,
          requested_client_users_total: 2,
          requested_client_users_resolved: 1,
          requested_devices_total: 2,
          requested_devices_resolved: 2,
        },
      })
    );

    await screen.findByRole('heading', { name: 'Execution recap' });
    const figure = (label: string) => screen.getByText(label).previousElementSibling?.textContent;

    expect(figure('Completed requested work')).toBe('5');
    expect(figure('Unresolved')).toBe('3');
    expect(figure('Additional actions')).toBe('4');
    expect(figure('Requested entities resolved')).toBe('3');
  });
});

describe('step 4 — final validation', () => {
  it('sums up the outcome and closes the request', async () => {
    vi.mocked(internal.completeRequest).mockResolvedValue(executed({ status: 'Completed' }));
    await renderPage(request(), executed());

    fireEvent.click(await screen.findByRole('button', { name: /continue to final validation/i }));

    expect(await screen.findByText('Complete this fulfilment after all accepted work is resolved.')).toBeInTheDocument();
    for (const figure of [
      '1 accepted request line completed',
      '1 rejected request line',
      '1 additional technician action completed',
      '0 Requested Client Users resolved',
      '0 Requested Devices resolved',
      '0 unresolved accepted work items',
    ]) {
      expect(screen.getByText(figure)).toBeInTheDocument();
    }
    expect(screen.getByText('READY TO COMPLETE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /validate & complete request/i }));
    fireEvent.click(screen.getByRole('button', { name: /validate & complete request/i }));

    await waitFor(() => expect(internal.completeRequest).toHaveBeenCalledWith({ name: 'SR-0001' }));
    expect(internal.completeRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Requests listing')).toBeInTheDocument();
  });

  it('reads the request again before leaving, so reopening it shows it completed', async () => {
    vi.mocked(internal.completeRequest).mockResolvedValue(executed({ status: 'Completed' }));
    await renderPage(request(), executed());

    fireEvent.click(await screen.findByRole('button', { name: /continue to final validation/i }));
    const readsBefore = vi.mocked(internal.getRequest).mock.calls.length;
    const presentationsBefore = vi.mocked(presentationApi.getInternalRequestPresentation).mock.calls.length;
    vi.mocked(internal.getRequest).mockResolvedValue(request({ status: 'Completed' }));

    fireEvent.click(screen.getByRole('button', { name: /validate & complete request/i }));

    expect(await screen.findByText('Requests listing')).toBeInTheDocument();
    expect(vi.mocked(internal.getRequest).mock.calls.length).toBeGreaterThan(readsBefore);
    expect(vi.mocked(presentationApi.getInternalRequestPresentation).mock.calls.length).toBeGreaterThan(
      presentationsBefore
    );
  });

  it('cannot complete while accepted work remains unresolved', async () => {
    await renderPage(
      request(),
      executed({
        action_groups: [actionGroup([card({ display_status: 'Completed' }), needsUsername(2)])],
        outcome: { ...executed().outcome, unresolved_accepted: 1 },
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: /continue to final validation/i }));

    expect(
      await screen.findByText('This Request cannot be completed while accepted work remains unresolved.')
    ).toBeInTheDocument();
    expect(screen.getByText('1 unresolved accepted work item')).toBeInTheDocument();
    expect(screen.queryByText('READY TO COMPLETE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /validate & complete request/i })).toBeDisabled();
  });
});

describe('step 4 — completion follows the server figure', () => {
  it('enables completion when the server counts nothing unresolved, although a row is not Completed', async () => {
    vi.mocked(internal.completeRequest).mockResolvedValue(executed({ status: 'Completed' }));
    await renderPage(
      request(),
      executed({
        action_groups: [actionGroup([card({ display_status: 'Completed' }), needsUsername(2)])],
        outcome: {
          ...executed().outcome,
          unresolved_accepted: 0,
          requested_client_users_total: 2,
          requested_client_users_resolved: 2,
          requested_devices_total: 1,
          requested_devices_resolved: 1,
        },
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: /continue to final validation/i }));

    expect(await screen.findByText('0 unresolved accepted work items')).toBeInTheDocument();
    expect(screen.getByText('2 Requested Client Users resolved')).toBeInTheDocument();
    expect(screen.getByText('1 Requested Device resolved')).toBeInTheDocument();
    expect(screen.getByText('READY TO COMPLETE')).toBeInTheDocument();
    expect(
      screen.queryByText('This Request cannot be completed while accepted work remains unresolved.')
    ).not.toBeInTheDocument();

    const complete = screen.getByRole('button', { name: /validate & complete request/i });
    expect(complete).toBeEnabled();
    fireEvent.click(complete);
    await waitFor(() => expect(internal.completeRequest).toHaveBeenCalledWith({ name: 'SR-0001' }));
  });

  it('refuses completion when the server counts unresolved work, although every row reads Completed', async () => {
    await renderPage(
      request(),
      executed({ outcome: { ...executed().outcome, unresolved_accepted: 2 } })
    );

    fireEvent.click(await screen.findByRole('button', { name: /continue to final validation/i }));

    expect(await screen.findByText('2 unresolved accepted work items')).toBeInTheDocument();
    expect(
      screen.getByText('This Request cannot be completed while accepted work remains unresolved.')
    ).toBeInTheDocument();
    expect(screen.queryByText('READY TO COMPLETE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /validate & complete request/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /validate & complete request/i }));
    expect(internal.completeRequest).not.toHaveBeenCalled();
  });
});

describe('no assignee anywhere', () => {
  it('names no assignee in execute, verify or final validation', async () => {
    await renderPage(request(), executed());
    const assignee = /assignee|assigned (to|me)/i;

    fireEvent.click(await screen.findByRole('button', { name: 'Execute' }));
    await screen.findByText('Execution view');
    expect(document.body.textContent).not.toMatch(assignee);

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('heading', { name: 'Execution recap' });
    expect(document.body.textContent).not.toMatch(assignee);

    fireEvent.click(screen.getByRole('button', { name: 'Final validation' }));
    await screen.findByText('Complete this fulfilment after all accepted work is resolved.');
    expect(document.body.textContent).not.toMatch(assignee);
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
      } as never),
      undefined,
      presentationOf([target(1)])
    );

    const people = await screen.findByRole('region', { name: 'People' });
    fireEvent.click(within(people).getByRole('button', { name: 'Person 1' }));

    expect(await screen.findByText('Username')).toBeInTheDocument();
    expect(screen.getByText('p.one')).toBeInTheDocument();
    expect(screen.getByText('p1@acme.com')).toBeInTheDocument();
    expect(screen.getByText('KV-P1 · SN-1')).toBeInTheDocument();
    expect(screen.getByText('Parallels')).toBeInTheDocument();
    expect(screen.getByText('SR-0099')).toBeInTheDocument();
    expect(screen.queryByText(/account/i)).not.toBeInTheDocument();
  });

  it('shows what the request says about somebody not on file yet', async () => {
    const newcomer = target(1, {
      subject_key: 'new:chloe',
      person_label: 'Chloe Mbarga',
      person_is_new: true,
      target_kind: 'requested_client_user',
    });
    const shown = presentationOf([newcomer], {
      requested_entities: [
        {
          kind: 'client_user',
          name: 'RCU-2026-00009',
          key: 'new:chloe',
          display_name: 'Chloe Mbarga',
          context_label: 'Requested Client User · Finance',
          status: 'Open',
          readiness: 'needs_review',
          badge: 'NEEDS REVIEW',
          resolved_to: null,
          requested_snapshot: { department: 'Finance', email: 'chloe@acme.com', username: null },
          prepared_values: {},
          requested_work_count: 1,
          relationship_summary: [],
        },
      ],
    });
    shown.subjects[0].department = 'Finance';
    await renderPage(
      request({ status: 'Under Review', can_decide_lines: true, lines: [line(1)] } as never),
      undefined,
      shown
    );

    const people = await screen.findByRole('region', { name: 'People' });
    expect(within(people).getByText('NEW')).toBeInTheDocument();
    fireEvent.click(within(people).getByRole('button', { name: 'Chloe Mbarga' }));

    expect(await screen.findByText('New person')).toBeInTheDocument();
    expect(within(people).getAllByText('Finance').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('chloe@acme.com')).toBeInTheDocument();
    expect(screen.getByText('NEEDS REVIEW')).toBeInTheDocument();
  });
});

describe('a machine to prepare for somebody on file', () => {
  it('is reviewed under that person, not as somebody new', async () => {
    await renderPage(
      request({ status: 'Under Review', can_decide_lines: true, lines: [line(1), line(2)] } as never),
      undefined,
      presentationOf([
        target(1),
        target(2, {
          subject_key: 'user:CU-1',
          person_label: 'Person 1',
          target_label: 'LAPTOP-NEW',
          target_kind: 'requested_device',
          target_badge: 'UNRESOLVED',
          operation_label: 'Add Sophos',
        }),
      ])
    );

    const row = (await screen.findByText('LAPTOP-NEW', { exact: false })).closest('tr') as HTMLElement;
    expect(within(row).getByText('Person 1')).toBeInTheDocument();
    expect(within(row).getByText('UNRESOLVED')).toBeInTheDocument();
    expect(within(row).getByText('Add Sophos')).toBeInTheDocument();
    expect(within(row).queryByText('NEW')).not.toBeInTheDocument();
    expect(screen.queryByText(/unnamed person/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^new person$/i)).not.toBeInTheDocument();
  });
});

describe('a request that is no longer worked on', () => {
  it('is read back through the shared presentation, without the fulfilment steps', async () => {
    const shown = presentationOf([target(1, { line_status: 'Rejected', rejection_reason: 'Out of scope' })]);
    shown.request.rejection = { reason: 'Out of scope', by: 'nexgen', by_name: null, at: null };
    await renderPage(
      request({ status: 'Rejected', rejection_reason: 'Out of scope' } as never),
      undefined,
      shown
    );

    expect(await screen.findByRole('heading', { name: 'Request SR-0001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Out of scope').length).toBeGreaterThanOrEqual(1);
    expect(within(document.querySelector('[data-section="rejection"]') as HTMLElement).getByText('Out of scope')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept all' })).not.toBeInTheDocument();
    expect(internal.getRequestExecutionPlan).not.toHaveBeenCalled();
  });

  it('is read only for somebody who may not decide its lines, keeping the request actions', async () => {
    await renderPage(
      request({ status: 'Under Review', can_decide_lines: false, lines: [line(1)] } as never),
      undefined,
      presentationOf([target(1)])
    );

    expect(await screen.findByRole('heading', { name: 'Request SR-0001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the requested intent once completed and appends the outcome and the recap', async () => {
    const shown = completedFixture();
    shown.request.name = 'SR-0001';
    await renderPage(request({ status: 'Completed' } as never), executed({ status: 'Completed' }), shown);

    expect(await screen.findByText('Completed request · final intent and fulfilment outcome.')).toBeInTheDocument();
    expect(screen.getByText('Add Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('Created during fulfilment')).toBeInTheDocument();
    expect(screen.getByText('Existing Device selected')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'View execution recap' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Microsoft 365 · Grant a service')).toBeInTheDocument();
    expect(within(dialog).getByText('Needed for remote work')).toBeInTheDocument();
  });
});

describe('what the page must never show', () => {
  it('says nothing about portal accounts', async () => {
    await renderPage(request(), plan());
    await screen.findByText('Execution view');

    expect(screen.queryByText(/portal access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite/i)).not.toBeInTheDocument();
  });
});
