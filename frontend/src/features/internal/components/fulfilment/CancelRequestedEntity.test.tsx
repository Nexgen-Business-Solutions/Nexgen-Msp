import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import * as internal from '@/lib/api/internal';
import type { ActionWorkGroup, ExecutionPlan, WorkCard } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import RequestedEntitiesSummary from '@/shared/request/RequestedEntitiesSummary';
import { entityRowMenu } from '../../lib/workRowMenu';
import ExecutionRecap from './ExecutionRecap';
import ExecutionWorkspace from './ExecutionWorkspace';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    cancelRequestedClientUser: vi.fn(),
    cancelRequestedDevice: vi.fn(),
    executeWorkOrders: vi.fn(),
    settleWorkDoneElsewhere: vi.fn(),
    recordRequestActivity: vi.fn(),
    listCustomerRequests: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
  };
});

const card = (name: string, overrides: Partial<WorkCard> = {}): WorkCard =>
  ({
    name,
    work_type: 'Service Action',
    operation_code: 'service.add',
    status: 'Pending',
    target_scope: 'User',
    subject_key: 'user:CU-1',
    client_user: 'CU-1',
    managed_device: null,
    service_item: 'M365',
    service_name: 'Microsoft 365',
    source_service_assignment: null,
    origin: 'Request',
    action_group_key: 'grp-m365',
    requirements: [],
    requested_client_user: null,
    requested_device: null,
    requested_holder_requested_client_user: null,
    display_status: 'Ready',
    failure_reason: null,
    target: { kind: 'client_user', name: 'CU-1', requested_entity: null, label: 'John Doe', sublabel: null, badge: null },
    relationship: null,
    primary_action: { operation_code: 'service.add', label: 'Add service', enabled: true },
    prerequisite_action: null,
    dependency_label: null,
    current: null,
    device: null,
    ...overrides,
  }) as WorkCard;

const group = (key: string, label: string, work: WorkCard[]): ActionWorkGroup => ({
  group_key: key,
  operation_code: 'service.add',
  label,
  scope_label: null,
  origin: 'Customer',
  total: work.length,
  remaining: work.filter((row) => !['Completed', 'Cancelled'].includes(row.display_status)).length,
  ready: work.filter((row) => row.display_status === 'Ready').length,
  needs_information: 0,
  by_status: {},
  work,
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
  requested_snapshot: { full_name: 'Marie Dupont', department: 'Purchasing' },
  prepared_values: {},
  requested_work_count: 2,
  relationship_summary: [],
  ...overrides,
});

const laptop = (overrides: Partial<RequestedEntityPresentation> = {}): RequestedEntityPresentation => ({
  kind: 'device',
  name: 'RDEV-1',
  key: 'new-device:laptop',
  display_name: 'New laptop',
  context_label: 'Requested Device · Laptop',
  status: 'Open',
  readiness: 'needs_review',
  badge: 'UNRESOLVED',
  resolved_to: null,
  requested_snapshot: {},
  prepared_values: {},
  requested_work_count: 1,
  relationship_summary: [],
  blocked_by: null,
  ...overrides,
});

const forMarie = (overrides: Partial<WorkCard> = {}) =>
  card('WO-M', {
    subject_key: 'new:marie',
    client_user: null,
    requested_client_user: 'RCU-1',
    display_status: 'Waiting for prerequisite',
    target: { kind: 'requested_client_user', name: null, requested_entity: 'RCU-1', label: 'Marie Dupont', sublabel: null, badge: 'NEW' },
    primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
    ...overrides,
  });

const onLaptop = (overrides: Partial<WorkCard> = {}) =>
  card('WO-L', {
    action_group_key: 'grp-av',
    target_scope: 'Device',
    requested_device: 'RDEV-1',
    service_item: 'AV',
    service_name: 'Antivirus',
    display_status: 'Waiting for prerequisite',
    target: { kind: 'requested_device', name: null, requested_entity: 'RDEV-1', label: 'New laptop', sublabel: null, badge: 'UNRESOLVED' },
    primary_action: { operation_code: 'service.add', label: 'Add service', enabled: false },
    ...overrides,
  });

const plan = (work: WorkCard[], entities: RequestedEntityPresentation[]): ExecutionPlan =>
  ({
    request: 'SR-0001',
    customer: 'ACME',
    status: 'In Progress',
    context: { requested_date: '2026-09-29' },
    recap: [],
    outcome: {},
    stages: { current: 'execute', stages: [] },
    action_groups: [
      group('grp-m365', 'Add Microsoft 365', work.filter((row) => row.action_group_key === 'grp-m365')),
      group('grp-av', 'Add Antivirus', work.filter((row) => row.action_group_key === 'grp-av')),
    ].filter((row) => row.work.length),
    requested_entities: entities,
    preparation: { new_people: 0, unresolved_devices: 0, missing_usernames: 0, missing_serials: 0 },
    people: [],
    requirements: [],
    rejected: [],
    summary: {},
    activity: [],
  }) as unknown as ExecutionPlan;

const show = (element: ReactElement) => {
  vi.mocked(internal.listCustomerRequests).mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>
  );
};

const workspace = (value: ExecutionPlan) => (
  <ExecutionWorkspace plan={value} onSaved={() => undefined} onContinue={() => undefined} />
);

const entityRow = (name: string) => document.querySelector(`[data-requested-entity="${name}"]`) as HTMLElement;
const workRow = (name: string) => document.querySelector(`[data-work-order="${name}"]`) as HTMLElement;

const openCancel = async (name: string) => {
  fireEvent.click(within(entityRow(name)).getByTitle('More options'));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cancel']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Cancel' }));
  return screen.findByRole('dialog');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('cancelling a requested person or machine from the Execute screen', () => {
  it('offers Cancel on an open requested row only', () => {
    const cancel = vi.fn();

    expect(entityRowMenu(marie(), cancel).map((action) => action.label)).toEqual(['Cancel']);
    expect(entityRowMenu(marie({ status: 'Resolved' }), cancel)).toEqual([]);
    expect(entityRowMenu(laptop({ status: 'Cancelled' }), cancel)).toEqual([]);

    show(
      workspace(
        plan(
          [forMarie({ status: 'Completed', display_status: 'Completed' })],
          [marie({ status: 'Resolved', resolved_to: { doctype: 'MSP Client User', name: 'CU-9', label: 'Marie Dupont', mode: 'Create New' } })]
        )
      )
    );

    expect(within(entityRow('RCU-1')).queryByTitle('More options')).toBeNull();
  });

  it('names what goes with the person, asks for a reason and cancels with it', async () => {
    vi.mocked(internal.cancelRequestedClientUser).mockResolvedValue({
      entity: marie({ status: 'Cancelled' }),
      plan: plan([], []),
    });
    show(workspace(plan([forMarie(), card('WO-J')], [marie()])));

    const dialog = await openCancel('RCU-1');
    const confirm = within(dialog).getByRole('button', { name: 'Cancel requested user' });

    expect(within(dialog).getByText('Marie Dupont', { selector: 'p' })).toBeTruthy();
    expect(
      within(within(dialog).getByRole('region', { name: 'Cancelled with it' })).getAllByRole('listitem').map((row) => row.textContent)
    ).toEqual(['Add Microsoft 365 · Marie Dupont']);
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(confirm.className).toContain('bg-red-600');
    expect(confirm.className).toContain('py-2.5');

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: '   ' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: ' Will not join ' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(vi.mocked(internal.cancelRequestedClientUser).mock.calls[0][0]).toEqual({ name: 'RCU-1', reason: 'Will not join' });
    expect(internal.cancelRequestedDevice).not.toHaveBeenCalled();
  });

  it('cancels a requested machine with its own button and keeps the dialog open on a refusal', async () => {
    vi.mocked(internal.cancelRequestedDevice).mockRejectedValue(new Error('A resolved requested target cannot be cancelled.'));
    show(workspace(plan([onLaptop()], [laptop()])));

    const dialog = await openCancel('RDEV-1');

    expect(
      within(within(dialog).getByRole('region', { name: 'Cancelled with it' })).getAllByRole('listitem').map((row) => row.textContent)
    ).toEqual(['Add Antivirus · New laptop']);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Out of stock' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel requested Device' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('A resolved requested target cannot be cancelled.');
    expect(vi.mocked(internal.cancelRequestedDevice).mock.calls[0][0]).toEqual({ name: 'RDEV-1', reason: 'Out of stock' });
    expect(internal.cancelRequestedClientUser).not.toHaveBeenCalled();
  });

  it('shows the row cancelled with its reason, its work cancelled and out of the counts', () => {
    const before = plan([forMarie(), card('WO-J')], [marie()]);
    const { rerender, container } = show(workspace(before));
    const executeButton = () => screen.queryByRole('button', { name: /^Execute \d+ ready$/ })?.textContent;

    expect(executeButton()).toBe('Execute 1 ready');
    expect(within(entityRow('RCU-1')).getByText('To do')).toBeTruthy();
    expect(screen.getByText('2 remaining · 0 completed')).toBeTruthy();
    expect(within(workRow('WO-M')).getByText('Waits for Marie Dupont')).toBeTruthy();

    const after = plan(
      [forMarie({ status: 'Cancelled', display_status: 'Cancelled' }), card('WO-J')],
      [marie({ status: 'Cancelled', badge: 'CANCELLED', cancel_reason: 'Will not join' })]
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{workspace(after)}</MemoryRouter>
      </QueryClientProvider>
    );

    const row = entityRow('RCU-1');
    expect(within(row).getByText('Cancelled')).toBeTruthy();
    expect(within(row).getByText('Will not join')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Create user' })).toBeNull();
    expect(within(row).queryByTitle('More options')).toBeNull();
    expect(within(workRow('WO-M')).getByText('Cancelled')).toBeTruthy();
    expect(within(workRow('WO-M')).queryByText(/Waits for/)).toBeNull();
    expect(container.textContent?.match(/Will not join/g)?.length).toBe(1);
    expect(executeButton()).toBe('Execute 1 ready');
    expect(screen.getByText('1 remaining · 0 completed')).toBeTruthy();
    expect(screen.queryByText('2 remaining · 0 completed')).toBeNull();
  });

  it('says in the recap what was cancelled, with what and why', () => {
    const recapPlan = {
      ...plan([forMarie({ status: 'Cancelled', display_status: 'Cancelled' })], [marie({ status: 'Cancelled', badge: 'CANCELLED', cancel_reason: 'Will not join' })]),
      recap: [
        {
          work_order: 'RCU-1',
          subject_key: 'new:marie',
          subject: 'Marie Dupont',
          department: 'Purchasing',
          kind: 'cancelled' as const,
          title: 'Requested Client User cancelled',
          detail: 'Add Microsoft 365',
          reason: 'Will not join',
          at: null,
          by: 'Tech One',
        },
      ],
      outcome: {
        accepted: 1,
        rejected: 0,
        requested_done: 0,
        unresolved_accepted: 0,
        technician_added: 0,
        technician_done: 0,
        requested_client_users_total: 0,
        requested_client_users_resolved: 0,
        requested_devices_total: 0,
        requested_devices_resolved: 0,
        requested_cancelled: 1,
      },
    } as ExecutionPlan;
    show(<ExecutionRecap plan={recapPlan} />);

    const block = screen.getByRole('region', { name: 'Requested entities' });
    expect(within(block).getByText(/Requested Client User cancelled · Add Microsoft 365/)).toBeTruthy();
    expect(within(block).getByText('Will not join')).toBeTruthy();
    expect(within(block).getByText('CANCELLED')).toBeTruthy();
  });

  it('gives the customer the reason once, beside the cancelled entity', () => {
    render(
      <RequestedEntitiesSummary
        entities={[marie({ status: 'Cancelled', badge: 'CANCELLED', cancel_reason: 'Will not join' }), laptop()]}
      />
    );

    expect(screen.getAllByText('Will not join')).toHaveLength(1);
    expect(screen.getByText('CANCELLED')).toBeTruthy();
  });
});
