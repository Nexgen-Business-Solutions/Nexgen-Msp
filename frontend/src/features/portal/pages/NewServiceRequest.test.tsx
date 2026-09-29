import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import { FrappeError } from '@/lib/api/client';
import * as presentationApi from '@/lib/api/requestPresentation';
import { presentationFixture } from '@/shared/request/presentation.fixture';
import NewServiceRequest from './NewServiceRequest';

const pageOf = <T,>(rows: T[]) => ({ rows, total: rows.length, truncated: false });

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return {
    ...actual,
    getMyApprovalRights: vi.fn(),
    searchRequestUsers: vi.fn(),
    getNewPersonContext: vi.fn(),
    getRequestSubmissionContext: vi.fn(),
    getDepartmentSelection: vi.fn(),
    getCompanySelection: vi.fn(),
    evaluateRequestScope: vi.fn(),
    evaluateRequestOperations: vi.fn(),
    createRequest: vi.fn(),
    updateRequest: vi.fn(),
    saveRequestDraft: vi.fn(),
    getRequest: vi.fn(),
    listSelectableClientUsers: vi.fn(),
    listSelectableDevices: vi.fn(),
  };
});

vi.mock('@/lib/api/requestPresentation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/requestPresentation')>();
  return { ...actual, previewRequest: vi.fn() };
});

vi.mock('@/shared/hooks/useSession', () => ({
  useSession: () => ({ data: { roles: ['MSP Customer Manager'] } }),
}));

vi.mock('@/features/internal/hooks/useUsers', () => ({
  useUserFilterOptions: () => ({ data: { customers: [] } }),
}));

const alice = {
  name: 'CU-001',
  full_name: 'Alice Ndom',
  email: 'alice@aci.cm',
  username: null,
  department: 'Purchasing',
  lifecycle_status: 'Active',
};
const brice = {
  name: 'CU-002',
  full_name: 'Brice Mvondo',
  email: 'brice@aci.cm',
  username: null,
  department: 'Purchasing',
  lifecycle_status: 'Active',
};

/** The server's reading of the two people, exactly as the People table renders it. */
const projection = (keys: string[]): { customer: string; subjects: portal.RequestSubjectRow[] } => ({
  customer: 'ACI',
  subjects: keys.map((key) =>
    key === 'user:CU-001'
      ? {
          subject_key: key,
          kind: 'existing' as const,
          client_user: 'CU-001',
          requested_client_user: null,
          full_name: 'Alice Ndom',
          department: 'Purchasing',
          email: 'alice@aci.cm',
          username: 'andom',
          added_via: 'Existing',
          selection_label: null,
          devices: [
            {
              name: 'MD-1',
              label: 'ACI-LT-011',
              status: 'Active',
              hostname: 'ACI-LT-011',
              device_type: 'Laptop',
              serial_number: 'SN-011',
            },
            {
              name: 'MD-2',
              label: 'ACI-PH-002',
              status: 'Active',
              hostname: 'ACI-PH-002',
              device_type: 'Phone',
              serial_number: null,
            },
            {
              name: 'MD-3',
              label: 'ACI-TAB-003',
              status: 'Active',
              hostname: 'ACI-TAB-003',
              device_type: 'Tablet',
              serial_number: null,
            },
          ],
          current_services: [
            {
              assignment: 'SA-1',
              service_item: 'NEXT',
              label: 'Nextcloud',
              scope: 'User' as const,
              status: 'Active',
              managed_device: null,
            },
            {
              assignment: 'SA-2',
              service_item: 'M365',
              label: 'Microsoft 365',
              scope: 'User' as const,
              status: 'Suspended',
              managed_device: null,
            },
          ],
          last_billed: '2026-09-24',
          usable: true,
          reason_code: null,
        }
      : key === 'user:CU-002'
        ? {
            subject_key: key,
            kind: 'existing' as const,
            client_user: 'CU-002',
            requested_client_user: null,
            full_name: 'Brice Mvondo',
            department: 'Purchasing',
            email: 'brice@aci.cm',
            username: null,
            added_via: 'Existing',
            selection_label: null,
            devices: [],
            current_services: [],
            last_billed: null,
            usable: true,
            reason_code: null,
          }
        : {
            subject_key: key,
            kind: 'new' as const,
            client_user: null,
            requested_client_user: null,
            full_name: 'Fresh Face',
            department: null,
            email: null,
            username: null,
            added_via: 'New',
            selection_label: null,
            devices: [],
            current_services: [],
            last_billed: null,
            usable: true,
            reason_code: null,
          }
  ),
});

const endNextcloud: portal.RequestOperationOption = {
  operation_code: 'service.end',
  operation_label: 'End',
  operation_label_snapshot: 'End Nextcloud',
  object_key: 'NEXT',
  object_label: 'Nextcloud',
  targets: [
    {
      subject_key: 'user:CU-001',
      client_user: 'CU-001',
      requested_client_user: null,
      full_name: 'Alice Ndom',
      department: 'Purchasing',
      target_scope: 'User',
      managed_device: null,
      device_requirement_key: null,
      requested_device: null,
      device_label: null,
      source_service_assignment: 'SA-1',
      current_state: 'Active',
    },
  ],
  exclusions: [
    {
      subject_key: 'user:CU-002',
      client_user: 'CU-002',
      full_name: 'Brice Mvondo',
      managed_device: null,
      device_label: null,
      current_state: null,
      reason_code: 'NO_CURRENT_ASSIGNMENT',
      reason: 'No current assignment for this service.',
    },
  ],
  applicable_target_count: 1,
  applicable_subject_count: 1,
  excluded_subject_count: 1,
};

const operations = {
  customer: 'ACI',
  selected_subject_count: 2,
  domains: [
    {
      key: 'Service' as const,
      label: 'Services',
      options: [
        {
          object_key: 'NEXT',
          object_label: 'Nextcloud',
          service_scope: 'User',
          current_count: 1,
          without_count: 1,
          actions: [endNextcloud],
        },
      ],
    },
  ],
};

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } });

const show = (entry = '/msp/requests/new') =>
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={[entry]}>
        <NewServiceRequest />
      </MemoryRouter>
    </QueryClientProvider>
  );

const selectable = (person: typeof alice, extra: Partial<portal.SelectableClientUser> = {}) => ({
  ...person,
  selectable: true,
  disabled_reason: null,
  ...extra,
});

const setUp = () => {
  vi.mocked(portal.getMyApprovalRights).mockResolvedValue({
    customer: 'ACI',
    has_authority: true,
    can_submit: true,
    can_approve: false,
    department: null,
    awaiting: 0,
  });
  vi.mocked(portal.searchRequestUsers).mockResolvedValue([alice, brice]);
  vi.mocked(portal.listSelectableClientUsers).mockResolvedValue(pageOf([selectable(alice), selectable(brice)]));
  vi.mocked(portal.listSelectableDevices).mockResolvedValue(pageOf([]));
  vi.mocked(presentationApi.previewRequest).mockResolvedValue(presentationFixture());
  vi.mocked(portal.getNewPersonContext).mockResolvedValue({
    customer: 'ACI',
    departments: [{ value: 'Purchasing', label: 'Purchasing' }],
    available_user_services: [],
    available_device_services: [],
  });
  vi.mocked(portal.getRequestSubmissionContext).mockResolvedValue({
    customer: 'ACI',
    message: 'This request reaches Nexgen straight away.',
  } as never);
  vi.mocked(portal.evaluateRequestScope).mockImplementation(async ({ subjects }) =>
    projection(subjects.map((subject) => subject.subject_key))
  );
  vi.mocked(portal.evaluateRequestOperations).mockResolvedValue(operations as never);
  vi.mocked(portal.createRequest).mockResolvedValue({ name: 'SR-1' } as never);
};

const rail = () => screen.getByText('Apply actions to').closest('aside') as HTMLElement;

const scopeEntry = (name: string) =>
  within(rail()).getByRole('button', { name: new RegExp(`^${name}`) });

const pickScope = async (name: string) => {
  await waitFor(() => expect(scopeEntry(name)).toBeInTheDocument());
  fireEvent.click(scopeEntry(name));
};

beforeEach(() => {
  window.localStorage.clear();
});

const addAlice = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Select existing/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add Alice Ndom' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
};

describe('The Request Builder, step by step', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('starts empty and says so', async () => {
    setUp();
    show();

    expect(await screen.findByText('Add people to start the request.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();
  });

  it('every selection method feeds the same table', async () => {
    setUp();
    show();
    await addAlice();

    const row = (await screen.findByText('Alice Ndom')).closest('tr') as HTMLElement;

    expect(within(row).getByText('2026-09-24')).toBeInTheDocument();
    expect(within(row).getByText('ACI-LT-011')).toBeInTheDocument();
    expect(within(row).getByText('+ 2 more')).toBeInTheDocument();
  });

  it('a suspended service is named as suspended, and never hidden', async () => {
    setUp();
    show();
    await addAlice();

    const row = (await screen.findByText('Alice Ndom')).closest('tr') as HTMLElement;
    const services = within(row).getByText('Nextcloud');

    expect(services).toBeInTheDocument();
    expect(within(row).getAllByTitle(/Microsoft 365 \(Suspended\)/).length).toBeGreaterThan(0);
  });

  it('the same person picked twice is one subject', async () => {
    setUp();
    vi.mocked(portal.getDepartmentSelection).mockResolvedValue({
      customer: 'ACI',
      selection_origin: 'Department',
      selection_label: 'Purchasing',
      selection_group_key: 'dept:Purchasing',
      selection_snapshot_at: '2026-09-28 10:00:00',
      active_count: 2,
      excluded_disabled_count: 0,
      department_count: 1,
      departments: ['Purchasing'],
      people: [alice, brice],
      excluded: [],
    });
    show();
    await addAlice();

    fireEvent.click(screen.getByRole('button', { name: /Select existing/ }));
    expect(await screen.findByRole('button', { name: 'Add Brice Mvondo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Alice Ndom' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByRole('button', { name: /^Department$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Select department/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Purchasing' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load Department' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load Department' }));

    expect(await screen.findAllByText('Alice Ndom')).toHaveLength(1);
    expect(await screen.findAllByText('Brice Mvondo')).toHaveLength(1);
  });

  it('a new person needs only their full name', async () => {
    setUp();
    show();

    fireEvent.click(screen.getByRole('button', { name: /New user/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add person' }));

    expect(screen.getByText("Enter the person's full name.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Fresh Face' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    expect(await screen.findByText('NEW')).toBeInTheDocument();
  });

  it('an action reaches the applicable targets and leaves the others alone', async () => {
    setUp();
    show();
    await addAlice();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText('Group actions stay explicit')).toBeInTheDocument();
    await pickScope('All selected');

    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));

    expect(await screen.findByText('End Nextcloud')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 people are applicable.')).toBeInTheDocument();
    expect(screen.getByText('Will apply')).toBeInTheDocument();
    expect(screen.getByText('Left unchanged')).toBeInTheDocument();
    expect(screen.getByLabelText('Include Brice Mvondo')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'New device for Brice Mvondo' }),
      'only NO_CURRENT_DEVICE offers a machine'
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));

    expect(await screen.findByText(/End Nextcloud/)).toBeInTheDocument();
    expect(screen.getByText(/1 target · All selected/)).toBeInTheDocument();
  });

  it('an eligible target the customer unchecks is not requested', async () => {
    setUp();
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));
    fireEvent.click(await screen.findByLabelText('Include Alice Ndom'));

    expect(screen.getByRole('button', { name: 'Add action' })).toBeDisabled();
  });

  it('submits people and grouped actions, and never a line for an unchanged person', async () => {
    setUp();
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add action' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(
      await screen.findByText('Confirm the exact snapshot and requested actions before submission.')
    ).toBeInTheDocument();
    expect(screen.getByText('People in snapshot')).toBeInTheDocument();
    expect(screen.getByText('Concrete targets')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(portal.createRequest).toHaveBeenCalled());

    const payload = vi.mocked(portal.createRequest).mock.calls[0][0];

    expect(payload).not.toHaveProperty('lines');
    expect(payload.subjects).toHaveLength(1);
    expect(payload.action_groups).toHaveLength(1);

    const group = payload.action_groups![0];

    expect(group.operation_code).toBe('service.end');
    expect(group.targets).toHaveLength(1);
    expect(group.selected_subject_count).toBe(1);
    expect(group.exclusions[0].reason_code).toBe('NO_CURRENT_ASSIGNMENT');
  });
});

const lastDialog = () => {
  const dialogs = screen.getAllByRole('dialog');
  return dialogs[dialogs.length - 1];
};

const addFresh = async (name = 'Fresh Face') => {
  fireEvent.click(screen.getByRole('button', { name: /New user/ }));
  fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
  await screen.findByText('NEW');
};

const toReviewAndSubmit = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit request' }));
  await waitFor(() => expect(portal.createRequest).toHaveBeenCalled());

  return vi.mocked(portal.createRequest).mock.calls[0][0];
};

const deviceOperations = (options: portal.RequestOperationOption[]) => ({
  customer: 'ACI',
  selected_subject_count: 2,
  domains: [{ key: 'Device' as const, label: 'Devices', options }],
});

const assignOption: portal.RequestOperationOption = {
  operation_code: 'device.assign',
  operation_label: 'Assign Device',
  operation_label_snapshot: 'Assign Device',
  object_key: null,
  object_label: 'Assign Device',
  targets: [
    {
      subject_key: 'user:CU-001',
      client_user: 'CU-001',
      requested_client_user: null,
      full_name: 'Alice Ndom',
      target_scope: 'Device',
      managed_device: null,
      device_requirement_key: null,
      requested_device: null,
      device_label: null,
      current_holder: null,
      current_holder_label: null,
      requested_holder: 'CU-001',
      requested_holder_subject_key: null,
      requested_holder_requested_client_user: null,
      source_service_assignment: null,
    },
  ],
  exclusions: [],
  applicable_target_count: 1,
  applicable_subject_count: 1,
  excluded_subject_count: 0,
  device_count: 0,
  without_device_count: 1,
  holder_options: [],
  stock_options: [],
  device_types: ['Laptop', 'Desktop'],
};

const transferOption: portal.RequestOperationOption = {
  operation_code: 'device.transfer',
  operation_label: 'Change holder',
  operation_label_snapshot: 'Change holder',
  object_key: null,
  object_label: 'Change holder',
  targets: [
    {
      subject_key: 'user:CU-001',
      client_user: 'CU-001',
      full_name: 'Alice Ndom',
      target_scope: 'Device',
      managed_device: 'MD-1',
      device_label: 'ACI-LT-011',
      current_holder: 'CU-001',
      current_holder_label: 'Alice Ndom',
      source_service_assignment: null,
    },
  ],
  exclusions: [],
  applicable_target_count: 1,
  applicable_subject_count: 1,
  excluded_subject_count: 0,
  device_count: 1,
  holder_options: [
    { value: 'CU-001', label: 'Alice Ndom', description: 'Purchasing' },
    { value: 'CU-002', label: 'Brice Mvondo', description: 'Purchasing' },
  ],
};

describe('people who do not exist yet', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('asks only for a full name, carries the six fields, and says nothing about accounts', async () => {
    setUp();
    vi.mocked(portal.saveRequestDraft).mockImplementation(
      async (payload) =>
        ({
          name: 'SR-D',
          subjects: payload.subjects.map((row) => ({ ...row, requested_client_user: 'RCU-2026-00001' })),
          requested_devices: [],
          action_groups: [],
        }) as never
    );
    show();

    fireEvent.click(screen.getByRole('button', { name: /New user/ }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('heading', { name: 'New person' })).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Fill what you have. Nexgen can complete the missing information during fulfilment.'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Optional. Leave this blank if you do not know it.')).toBeInTheDocument();
    for (const label of ['Full name', 'Department', 'Email', 'Username', 'Start date']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText('External employee ID')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/account|password|portal|login|invitation|access/i);
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(3);

    fireEvent.change(within(dialog).getByLabelText('Full name'), { target: { value: 'Marie Dupont' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'No Department yet' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Purchasing' }));
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'marie@aci.cm' } });
    fireEvent.change(within(dialog).getByLabelText('Username'), { target: { value: 'm.dupont' } });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));

    const badge = await screen.findByText('NEW');
    expect(badge.className).toContain('amber');
    expect(screen.queryByText(/warning/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await waitFor(() => expect(portal.saveRequestDraft).toHaveBeenCalled());

    const payload = vi.mocked(portal.saveRequestDraft).mock.calls[0][0];
    expect(payload).not.toHaveProperty('lines');
    expect(payload.subjects).toEqual([
      expect.objectContaining({
        kind: 'new',
        client_user: null,
        requested_client_user: null,
        full_name: 'Marie Dupont',
        department: 'Purchasing',
        email: 'marie@aci.cm',
        username: 'm.dupont',
        external_employee_id: null,
        start_date: '2026-10-01',
        added_via: 'New',
      }),
    ]);
    expect(payload.subjects[0].subject_key).toMatch(/^new:/);
  });

  it('adds somebody with a full name only', async () => {
    setUp();
    show();

    fireEvent.click(screen.getByRole('button', { name: /New user/ }));
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Only A Name' } });
    const add = screen.getByRole('button', { name: 'Add person' });
    expect(add).toBeEnabled();
    fireEvent.click(add);

    const row = (await screen.findByText('NEW')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Fresh Face')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('choosing existing people and machines', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows disabled and archived people in grey, with the reason, and never adds them', async () => {
    setUp();
    vi.mocked(portal.listSelectableClientUsers).mockResolvedValue(pageOf([
      selectable(alice),
      selectable(
        { ...brice, name: 'CU-003', full_name: 'Carla Disabled', lifecycle_status: 'Disabled' },
        { selectable: false, disabled_reason: 'This record is disabled and cannot be selected.' }
      ),
      selectable(
        { ...brice, name: 'CU-004', full_name: 'Dan Archived', lifecycle_status: 'Archived' },
        { selectable: false, disabled_reason: 'This record is disabled and cannot be selected.' }
      ),
    ]));
    show();

    fireEvent.click(screen.getByRole('button', { name: /Select existing/ }));
    const carla = await screen.findByRole('button', { name: 'Add Carla Disabled' });
    const dan = screen.getByRole('button', { name: 'Add Dan Archived' });

    expect(carla).toBeDisabled();
    expect(dan).toBeDisabled();
    expect(screen.getByText('Carla Disabled')).toHaveClass('text-slate-400');
    expect(screen.getAllByText('This record is disabled and cannot be selected.')).toHaveLength(2);
    expect(carla.closest('[data-person]')).toHaveAttribute(
      'title',
      'This record is disabled and cannot be selected.'
    );

    fireEvent.click(carla);
    fireEvent.click(dan);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByText('Carla Disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Dan Archived')).not.toBeInTheDocument();
    expect(screen.getByText('Add people to start the request.')).toBeInTheDocument();
  });

  it('lists every machine: a retired one greyed and shut, a held one chosen', async () => {
    setUp();
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValue(
      deviceOperations([assignOption]) as never
    );
    vi.mocked(portal.listSelectableDevices).mockResolvedValue(pageOf([
      {
        name: 'MD-9',
        hostname: 'ACI-LT-009',
        serial_number: 'SN-9',
        asset_tag: null,
        device_type: 'Laptop',
        status: 'Retired',
        current_holder: null,
        current_holder_name: null,
        selectable: false,
        unavailable_reason: 'This Device is retired and cannot be selected.',
      },
      {
        name: 'MD-5',
        hostname: 'ACI-LT-005',
        serial_number: 'SN-5',
        asset_tag: null,
        device_type: 'Laptop',
        status: 'Active',
        current_holder: 'CU-002',
        current_holder_name: 'Brice Mvondo',
        selectable: true,
        unavailable_reason: null,
      },
    ]));
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Ask for a Device' }));
    const asking = (await screen.findByLabelText('Include Alice Ndom')).closest('tr') as HTMLElement;
    expect(within(asking).getByText('ACI-LT-011, ACI-PH-002, ACI-TAB-003')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a Device for Alice Ndom' }));

    const picker = lastDialog();
    const retired = await within(picker).findByRole('button', { name: 'Choose ACI-LT-009' });
    expect(retired).toBeDisabled();
    expect(within(picker).getByText('This Device is retired and cannot be selected.')).toBeInTheDocument();
    expect(within(picker).getByText('ACI-LT-009')).toHaveClass('text-slate-400');

    const held = within(picker).getByRole('button', { name: 'Choose ACI-LT-005' });
    const heldRow = held.closest('tr') as HTMLElement;
    expect(within(heldRow).getByText('SN-5')).toBeInTheDocument();
    expect(within(heldRow).getByText('Active')).toBeInTheDocument();
    expect(within(heldRow).getByText('Brice Mvondo')).toBeInTheDocument();
    expect(
      within(picker).getByText(
        'Current status and holder are shown for context. Devices are not limited to unassigned stock.'
      )
    ).toBeInTheDocument();
    expect(held).toBeEnabled();

    fireEvent.click(retired);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.click(held);

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('ACI-LT-005')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));

    const payload = await toReviewAndSubmit();
    expect(payload.action_groups[0].targets[0]).toMatchObject({
      subject_key: 'user:CU-001',
      managed_device: 'MD-5',
      current_holder: 'CU-002',
    });
  });
});

describe('machines and holders that do not exist yet', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('hands a machine to a future person by their key, never as an existing holder', async () => {
    setUp();
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValue(
      deviceOperations([transferOption]) as never
    );
    show();
    await addAlice();
    await addFresh();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Configure transfers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'No change' }));
    fireEvent.click(await screen.findByRole('option', { name: /Fresh Face/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add configured transfers' }));

    const payload = await toReviewAndSubmit();
    const fresh = payload.subjects.find((row) => row.kind === 'new');
    const target = payload.action_groups[0].targets[0];

    expect(target.requested_holder_subject_key).toBe(fresh?.subject_key);
    expect(target).not.toHaveProperty('requested_holder');
    expect(target.managed_device).toBe('MD-1');
  });

  it('names the current holder of each Device the way the server does', async () => {
    setUp();
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValue(
      deviceOperations([
        {
          ...transferOption,
          targets: [{ ...transferOption.targets[0], current_holder_label: 'Alice Ndom-Essomba' }],
        },
      ]) as never
    );
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await pickScope('All selected');

    fireEvent.click(await screen.findByRole('button', { name: 'Configure transfers' }));
    const row = (await screen.findByText('ACI-LT-011')).closest('tr') as HTMLElement;

    expect(within(row).getByText('Alice Ndom-Essomba')).toBeInTheDocument();
    expect(within(row).queryByText('Alice Ndom')).not.toBeInTheDocument();
  });

  it('describes one machine with nothing filled in, and every act on it points at that one', async () => {
    setUp();
    vi.mocked(portal.evaluateRequestOperations).mockImplementation(async ({ subjects }) => {
      const service = (item: string, label: string) => ({
        object_key: item,
        object_label: label,
        service_scope: 'Device',
        current_count: 0,
        without_count: 1,
        actions: [
          {
            operation_code: 'service.add',
            operation_label: 'Add',
            operation_label_snapshot: `Add ${label}`,
            object_key: item,
            object_label: label,
            targets: [],
            exclusions: subjects
              .filter((row) => row.kind === 'new')
              .map((row) => ({
                subject_key: row.subject_key,
                client_user: null,
                full_name: row.full_name,
                managed_device: null,
                device_label: null,
                current_state: null,
                reason_code: 'NO_CURRENT_DEVICE',
                reason: 'Person has no current Device.',
              })),
            applicable_target_count: 0,
            applicable_subject_count: 0,
            excluded_subject_count: 1,
          },
        ],
      });

      return {
        customer: 'ACI',
        selected_subject_count: 1,
        domains: [
          {
            key: 'Service' as const,
            label: 'Services',
            options: [service('SOPHOS', 'Sophos'), service('BACKUP', 'Backup')],
          },
        ],
      } as never;
    });
    show();
    await addFresh();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    const sophos = (await screen.findByText('Sophos')).closest('tr') as HTMLElement;
    fireEvent.click(within(sophos).getByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New device for Fresh Face' }));

    const modal = lastDialog();
    expect(within(modal).getByRole('heading', { name: 'New device' })).toBeInTheDocument();
    expect(
      within(modal).getByText(
        'Fill what you have. Nexgen can complete the missing information during fulfilment.'
      )
    ).toBeInTheDocument();
    for (const label of [
      'Device type',
      'Hostname',
      'Serial number',
      'Asset tag',
      'Manufacturer',
      'Model',
      'Operating system',
      'Intended holder',
    ]) {
      expect(within(modal).getByText(label)).toBeInTheDocument();
    }
    expect(within(modal).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Add device' }));

    const impact = lastDialog();
    expect(within(impact).getByText('NEW DEVICE')).toBeInTheDocument();
    expect(within(impact).getByLabelText('Include Fresh Face')).toBeChecked();
    fireEvent.click(within(impact).getByRole('button', { name: 'Add action' }));

    expect(await screen.findByText('Assign Device')).toBeInTheDocument();

    const backup = screen.getByText('Backup').closest('tr') as HTMLElement;
    fireEvent.click(within(backup).getByRole('button', { name: 'Add' }));
    expect(screen.queryByRole('button', { name: 'New device for Fresh Face' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Use New device for Fresh Face' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));

    const payload = await toReviewAndSubmit();
    const targets = payload.action_groups.flatMap((group) => group.targets);

    expect(payload.requested_devices).toHaveLength(1);
    expect(payload.requested_devices[0]).toMatchObject({
      display_label: 'New device',
      device_type: null,
      hostname: null,
      serial_number: null,
      intended_holder_subject_key: payload.subjects[0].subject_key,
    });
    expect(payload.requested_devices[0].device_requirement_key).toMatch(/^new-device:/);
    expect(payload.action_groups.map((group) => group.operation_code)).toEqual([
      'device.assign',
      'service.add',
      'service.add',
    ]);
    expect(targets).toHaveLength(3);
    expect(new Set(targets.map((row) => row.device_requirement_key))).toEqual(
      new Set([payload.requested_devices[0].device_requirement_key])
    );
  });
});

describe('the review and the draft', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders what the server previewed, from exactly what the builder holds', async () => {
    setUp();
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add action' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.change(screen.getByLabelText('Requested date'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('Business note'), { target: { value: 'Before Monday.' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText('Add Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('8 targets from 9 people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Submit request' })).toHaveLength(1);

    const previewed = vi.mocked(presentationApi.previewRequest).mock.calls.at(-1)?.[0];

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(portal.createRequest).toHaveBeenCalled());

    const sent = vi.mocked(portal.createRequest).mock.calls[0][0];

    expect(previewed).toEqual({
      customer: undefined,
      priority: sent.priority,
      details: 'Before Monday.',
      requested_date: '2026-10-05',
      subjects: sent.subjects,
      requested_devices: sent.requested_devices,
      action_groups: sent.action_groups,
    });
    expect(sent.requested_date).toBe('2026-10-05');
    expect(sent.action_groups[0]).not.toHaveProperty('requested_effective_date');
  });

  it('goes back to the actions from the review', async () => {
    setUp();
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add action' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit actions' }));

    expect(await screen.findByText('Group actions stay explicit')).toBeInTheDocument();
  });

  it('says so when the review cannot be prepared', async () => {
    setUp();
    vi.mocked(presentationApi.previewRequest).mockRejectedValue(new Error('The preview failed.'));
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add action' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText('The preview failed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit request' })).not.toBeInTheDocument();
  });

  it('refuses a draft it cannot restore, with the exact words, and offers no save', async () => {
    setUp();
    vi.mocked(portal.getRequest).mockResolvedValue({
      name: 'SR-OLD',
      customer: 'ACI',
      request_type: 'Change',
      status: 'Draft',
      priority: 'Medium',
      details: null,
      requested_date: null,
      source: 'Portal',
      creation: '2026-09-28',
      modified: '2026-09-28',
      rejection_reason: null,
      refused_by_customer: false,
      reviewed_on: null,
      can_decide: false,
      can_edit: false,
      has_approver: true,
      lines: [],
      subjects: [
        {
          subject_key: 'user:CU-001',
          kind: 'existing',
          client_user: 'CU-001',
          requested_client_user: null,
          full_name: 'Alice Ndom',
          department: 'Purchasing',
          email: 'alice@aci.cm',
          username: null,
          external_employee_id: null,
          start_date: null,
          added_via: 'Existing',
          selection_label: null,
        },
      ],
      requested_devices: [],
      restorable: false,
      action_groups: [],
    });
    show('/msp/requests/new?draft=SR-OLD');

    expect(
      await screen.findByText(
        'This draft contains request data that could not be restored safely. Do not resave it. Contact Nexgen support.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save draft/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit request' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    expect(portal.saveRequestDraft).not.toHaveBeenCalled();
  });

  it('asks for a review when the people change after an action, and blocks submission', async () => {
    setUp();
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await pickScope('All selected');
    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add action' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    fireEvent.click(screen.getByRole('button', { name: /Select existing/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Brice Mvondo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText('Needs review')).toHaveAttribute(
      'title',
      'The people in this scope changed after this action was added. Review its impact before submitting.'
    );
    expect(
      screen.getByText('Some requested actions need review because the people in their scope changed.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByRole('button', { name: 'Submit request' })).toBeDisabled();
    expect(
      screen.getByText('Some requested actions need review because the people in their scope changed.')
    ).toBeInTheDocument();
  });
});

const groupSelection = (origin: 'Department' | 'Company') => ({
  customer: 'ACI',
  selection_origin: origin,
  selection_label: origin === 'Department' ? 'Purchasing' : 'ACI',
  selection_group_key: origin === 'Department' ? 'dept:Purchasing' : 'company:ACI',
  selection_snapshot_at: '2026-09-28 10:00:00',
  active_count: 2,
  excluded_disabled_count: 0,
  department_count: 1,
  departments: ['Purchasing'],
  people: [alice, brice],
  excluded: [],
});

const savedDraft = (via: { alice: string; brice: string }) =>
  ({
    name: 'SR-D',
    customer: 'ACI',
    request_type: 'Change',
    status: 'Draft',
    priority: 'Medium',
    details: null,
    requested_date: null,
    source: 'Portal',
    creation: '2026-09-28',
    modified: '2026-09-28',
    rejection_reason: null,
    refused_by_customer: false,
    reviewed_on: null,
    can_decide: false,
    can_edit: false,
    has_approver: true,
    lines: [],
    subjects: [
      [alice, via.alice],
      [brice, via.brice],
    ].map(([person, addedVia]) => ({
      subject_key: `user:${(person as typeof alice).name}`,
      kind: 'existing',
      client_user: (person as typeof alice).name,
      requested_client_user: null,
      full_name: (person as typeof alice).full_name,
      department: 'Purchasing',
      email: (person as typeof alice).email,
      username: null,
      external_employee_id: null,
      start_date: null,
      added_via: addedVia,
      selection_label: addedVia === 'Existing' ? null : 'Purchasing',
    })),
    requested_devices: [],
    restorable: true,
    action_groups: [],
  }) as never;

const openDraft = async (via: { alice: string; brice: string }) => {
  vi.mocked(portal.getRequest).mockResolvedValue(savedDraft(via));
  const view = show('/msp/requests/new?draft=SR-D');
  await screen.findByText('Brice Mvondo');
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Group actions stay explicit');
  await waitFor(() => expect(scopeEntry('Brice Mvondo')).toBeInTheDocument());

  return view;
};

const opensOn = (name: string, heading: string) => {
  expect(scopeEntry(name)).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  for (const other of ['All selected', 'Purchasing', 'Alice Ndom', 'Brice Mvondo'].filter(
    (entry) => entry !== name
  )) {
    expect(scopeEntry(other)).not.toHaveAttribute('aria-current');
  }
};

describe('where the Actions step opens', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('opens on the first person, with their details and machines, when somebody was added by hand', async () => {
    setUp();
    vi.mocked(portal.getDepartmentSelection).mockResolvedValue(groupSelection('Department'));
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /^Department$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Select department/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Purchasing' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load Department' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load Department' }));
    await screen.findByText('Brice Mvondo');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByText('Group actions stay explicit');
    await waitFor(() => expect(scopeEntry('Brice Mvondo')).toBeInTheDocument());

    opensOn('Alice Ndom', 'Alice Ndom');
    expect(screen.queryByRole('button', { name: 'View people' })).not.toBeInTheDocument();

    const details = screen.getByRole('region', { name: 'Alice Ndom details' });
    expect(within(details).getByText('andom')).toBeInTheDocument();
    expect(within(details).getByText('alice@aci.cm')).toBeInTheDocument();
    const machines = within(details).getAllByRole('row').slice(1);
    expect(machines.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent))).toEqual([
      ['ACI-LT-011', 'Laptop', 'SN-011', '—'],
      ['ACI-PH-002', 'Phone', '—', '—'],
      ['ACI-TAB-003', 'Tablet', '—', '—'],
    ]);
  });

  it('offers nothing to click while the options of another scope are still being read', async () => {
    setUp();
    let answer: (value: never) => void = () => undefined;
    vi.mocked(portal.evaluateRequestOperations)
      .mockResolvedValueOnce(operations as never)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Select existing/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Brice Mvondo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    const action = () =>
      within(screen.getByText('Nextcloud').closest('tr') as HTMLElement).getByRole('button', {
        name: 'End · 1',
      });

    await waitFor(() => expect(action()).toBeEnabled());

    await pickScope('Brice Mvondo');
    await waitFor(() => expect(portal.evaluateRequestOperations).toHaveBeenCalledTimes(2));
    expect(action()).toBeDisabled();

    answer(operations as never);
    await waitFor(() => expect(action()).toBeEnabled());
  });

  it('opens on All selected when everybody came in through a Department', async () => {
    setUp();
    vi.mocked(portal.getDepartmentSelection).mockResolvedValue(groupSelection('Department'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Department$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Select department/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Purchasing' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load Department' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load Department' }));
    await screen.findByText('Brice Mvondo');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByText('Group actions stay explicit');
    await waitFor(() => expect(scopeEntry('Brice Mvondo')).toBeInTheDocument());

    opensOn('All selected', 'All selected people');
    expect(screen.getByRole('button', { name: 'View people' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /details$/ })).not.toBeInTheDocument();
  });

  it('opens on All selected when everybody came in with the entire company', async () => {
    setUp();
    vi.mocked(portal.getCompanySelection).mockResolvedValue(groupSelection('Company'));
    show();
    fireEvent.click(screen.getByRole('button', { name: /Entire company/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add entire company' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add entire company' }));
    await screen.findByText('Brice Mvondo');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByText('Group actions stay explicit');
    await waitFor(() => expect(scopeEntry('Brice Mvondo')).toBeInTheDocument());

    opensOn('All selected', 'All selected people');
  });

  it('reads the origin of a saved draft: one person by hand is enough to open on the first person', async () => {
    setUp();
    await openDraft({ alice: 'Department', brice: 'Existing' });

    opensOn('Alice Ndom', 'Alice Ndom');
    cleanup();

    await openDraft({ alice: 'Department', brice: 'Company' });
    opensOn('All selected', 'All selected people');
  });

  it('remembers the scope picked in a saved draft and opens on it again', async () => {
    setUp();
    await openDraft({ alice: 'Existing', brice: 'Existing' });
    opensOn('Alice Ndom', 'Alice Ndom');

    fireEvent.click(scopeEntry('Purchasing'));
    opensOn('Purchasing', 'Purchasing Department');
    expect(JSON.parse(window.localStorage.getItem('msp.request.scope.SR-D') as string)).toEqual({
      type: 'Department',
      key: 'Purchasing',
      label: 'Purchasing',
    });
    cleanup();

    await openDraft({ alice: 'Existing', brice: 'Existing' });
    opensOn('Purchasing', 'Purchasing Department');
  });

  it('restores a remembered person, and ignores one who is no longer in the request', async () => {
    setUp();
    window.localStorage.setItem(
      'msp.request.scope.SR-D',
      JSON.stringify({ type: 'Person', key: 'user:CU-002', label: 'Brice Mvondo' })
    );
    await openDraft({ alice: 'Existing', brice: 'Existing' });
    opensOn('Brice Mvondo', 'Brice Mvondo');
    cleanup();

    window.localStorage.setItem(
      'msp.request.scope.SR-D',
      JSON.stringify({ type: 'Person', key: 'user:CU-999', label: 'Gone Person' })
    );
    await openDraft({ alice: 'Existing', brice: 'Existing' });
    opensOn('Alice Ndom', 'Alice Ndom');
  });

  it('keeps no scope for a request that is not a saved draft', async () => {
    setUp();
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await pickScope('All selected');

    expect(scopeEntry('All selected')).toHaveAttribute('aria-current', 'true');
    expect(window.localStorage.length).toBe(0);
  });

  it('changes nothing when the browser storage throws', async () => {
    setUp();
    window.localStorage.setItem(
      'msp.request.scope.SR-D',
      JSON.stringify({ type: 'Person', key: 'user:CU-002', label: 'Brice Mvondo' })
    );
    const reading = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is disabled.');
    });
    const writing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage is disabled.');
    });

    await openDraft({ alice: 'Existing', brice: 'Existing' });
    expect(reading).toHaveBeenCalledWith('msp.request.scope.SR-D');
    opensOn('Alice Ndom', 'Alice Ndom');

    fireEvent.click(scopeEntry('Brice Mvondo'));
    expect(writing).toHaveBeenCalled();
    opensOn('Brice Mvondo', 'Brice Mvondo');
  });
});

const endGroup = {
  group_key: 'grp:end-next',
  operation_code: 'service.end',
  operation_label_snapshot: 'End Nextcloud',
  domain: 'Service',
  service_item: 'NEXT',
  group_origin: 'Customer',
  source_scope_type: 'Person',
  source_scope_key: 'user:CU-001',
  source_scope_label: 'Alice Ndom',
  selected_subject_count: 1,
  applicable_target_count: 1,
  excluded_subject_count: 0,
  configuration: { comment: null, targets: endNextcloud.targets, exclusions: [] },
  impact: [],
};

const sentRequest = (overrides: Partial<portal.PortalRequestDetail> = {}): portal.PortalRequestDetail => ({
  name: 'SR-9',
  customer: 'ACI',
  request_type: 'Change',
  status: 'Submitted',
  priority: 'High',
  details: 'Before Friday.',
  requested_date: '2026-10-02',
  source: 'Portal',
  creation: '2026-09-28',
  modified: '2026-09-28',
  rejection_reason: null,
  refused_by_customer: false,
  reviewed_on: null,
  can_decide: false,
  can_edit: true,
  has_approver: true,
  lines: [],
  subjects: [
    {
      subject_key: 'user:CU-001',
      kind: 'existing',
      client_user: 'CU-001',
      requested_client_user: null,
      full_name: 'Alice Ndom',
      department: 'Purchasing',
      email: 'alice@aci.cm',
      username: null,
      external_employee_id: null,
      start_date: null,
      added_via: 'Existing',
      selection_label: null,
    },
  ],
  requested_devices: [],
  restorable: true,
  action_groups: [endGroup],
  ...overrides,
});

const sentPayload = {
  name: 'SR-9',
  priority: 'High',
  details: 'Before Friday.',
  requested_date: '2026-10-02',
  subjects: [
    {
      subject_key: 'user:CU-001',
      kind: 'existing',
      client_user: 'CU-001',
      requested_client_user: null,
      full_name: 'Alice Ndom',
      department: 'Purchasing',
      email: 'alice@aci.cm',
      username: null,
      external_employee_id: null,
      start_date: null,
      added_via: 'Existing',
      selection_label: null,
    },
  ],
  requested_devices: [],
  action_groups: [
    {
      group_key: 'grp:end-next',
      operation_code: 'service.end',
      operation_label_snapshot: 'End Nextcloud',
      domain: 'Service',
      service_item: 'NEXT',
      source_scope_type: 'Person',
      source_scope_key: 'user:CU-001',
      source_scope_label: 'Alice Ndom',
      selected_subject_count: 1,
      targets: endNextcloud.targets,
      exclusions: [],
    },
  ],
};

const showRoutes = (entry: string) =>
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/msp/requests/new" element={<NewServiceRequest />} />
          <Route path="/msp/requests/:name" element={<div>Request detail page</div>} />
          <Route path="/msp/requests" element={<div>Requests listing</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

const openForEdit = async (request = sentRequest()) => {
  vi.mocked(portal.getRequest).mockResolvedValue(request);
  showRoutes('/msp/requests/new?edit=SR-9');
  expect(await screen.findByRole('heading', { name: 'Edit request SR-9' })).toBeInTheDocument();
  await screen.findByText('Alice Ndom');
};

const toReview = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByText('Group actions stay explicit');
  await pickScope('All selected');
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  return screen.findByRole('button', { name: 'Save changes' });
};

describe('a sent request, opened in the builder to be modified', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('is titled after the request, and offers neither "Save draft" nor "Discard"', async () => {
    setUp();
    await openForEdit();

    expect(screen.queryByRole('heading', { name: 'New request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save draft/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument();
    expect(portal.getRequest).toHaveBeenCalledWith('SR-9', expect.anything());
  });

  it('saves exactly what the builder holds under the request name, then opens the request', async () => {
    setUp();
    vi.mocked(portal.updateRequest).mockResolvedValue(sentRequest());
    await openForEdit();

    const save = await toReview();
    expect(window.localStorage.getItem('msp.request.scope.SR-9')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit request' })).not.toBeInTheDocument();
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(await screen.findByText('Request detail page')).toBeInTheDocument();
    expect(portal.updateRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(portal.updateRequest).mock.calls[0][0]).toEqual(sentPayload);
    expect(portal.createRequest).not.toHaveBeenCalled();
    expect(portal.saveRequestDraft).not.toHaveBeenCalled();
  });

  it('shows the refusal word for word and keeps everything, so the same save can be tried again', async () => {
    setUp();
    vi.mocked(portal.updateRequest).mockRejectedValue(
      new FrappeError('This request can no longer be modified: work on it has started.', 417, 'REQUEST_LOCKED')
    );
    await openForEdit();

    fireEvent.click(await toReview());

    expect(
      await screen.findByText('This request can no longer be modified: work on it has started.')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit request SR-9' })).toBeInTheDocument();
    expect(screen.queryByText('Request detail page')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(portal.updateRequest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(portal.updateRequest).mock.calls[1][0]).toEqual(sentPayload);
    expect(portal.createRequest).not.toHaveBeenCalled();
    expect(portal.saveRequestDraft).not.toHaveBeenCalled();
  });
});

describe('a request that may no longer be modified', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('cannot be opened in the builder, and leads back to the request', async () => {
    setUp();
    vi.mocked(portal.getRequest).mockResolvedValue(sentRequest({ status: 'Under Review', can_edit: false }));
    showRoutes('/msp/requests/new?edit=SR-9');

    expect(
      await screen.findByText('This request can no longer be modified: work on it has started.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Edit request SR-9' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alice Ndom')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the request' }));
    expect(await screen.findByText('Request detail page')).toBeInTheDocument();
    expect(portal.updateRequest).not.toHaveBeenCalled();
    expect(portal.createRequest).not.toHaveBeenCalled();
    expect(portal.saveRequestDraft).not.toHaveBeenCalled();
  });

  it('is not reopened as a draft either, nor corrected as a refused one', async () => {
    setUp();
    vi.mocked(portal.getRequest).mockResolvedValue(sentRequest({ status: 'Under Review', can_edit: false }));

    for (const entry of ['/msp/requests/new?draft=SR-9', '/msp/requests/new?from=SR-9']) {
      showRoutes(entry);
      expect(
        await screen.findByText('This request can no longer be modified: work on it has started.'),
        entry
      ).toBeInTheDocument();
      expect(screen.queryByText('Alice Ndom'), entry).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('several machines for one person', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const inStock = (name: string, hostname: string) => ({
    name,
    hostname,
    serial_number: null,
    asset_tag: null,
    device_type: 'Laptop',
    status: 'Stock',
    current_holder: null,
    current_holder_name: null,
    selectable: true,
    unavailable_reason: null,
  });

  const askAgain = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for a Device' }));

    return (await screen.findByLabelText('Include Alice Ndom')).closest('tr') as HTMLElement;
  };

  const pick = async (row: HTMLElement, hostname: string) => {
    fireEvent.click(within(row).getByRole('button', { name: /Choose a Device for Alice Ndom|Change/ }));
    fireEvent.click(await within(lastDialog()).findByRole('button', { name: `Choose ${hostname}` }));
  };

  it('asks the same person four machines, each its own act, and never the same one twice', async () => {
    setUp();
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValue(
      deviceOperations([assignOption]) as never
    );
    vi.mocked(portal.listSelectableDevices).mockResolvedValue(
      pageOf([inStock('MD-5', 'ACI-LT-005'), inStock('MD-6', 'ACI-LT-006')])
    );
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    let row = await askAgain();
    expect(within(row).getByLabelText('Include Alice Ndom')).toBeChecked();
    await pick(row, 'ACI-LT-005');
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('1 asked')).toBeInTheDocument();

    row = await askAgain();
    const include = within(row).getByLabelText('Include Alice Ndom');
    expect(include, 'the act stays open to a person who already has one').toBeEnabled();
    expect(include, 'but a second machine is a choice, not a default').not.toBeChecked();
    expect(within(row).getByText('Already asked in this request: ACI-LT-005')).toBeInTheDocument();
    fireEvent.click(include);
    fireEvent.click(within(row).getByRole('button', { name: 'Choose a Device for Alice Ndom' }));
    expect(
      await within(lastDialog()).findByRole('button', { name: 'Choose ACI-LT-005' }),
      'the same machine cannot be asked twice'
    ).toBeDisabled();
    fireEvent.click(within(lastDialog()).getByRole('button', { name: 'Choose ACI-LT-006' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    row = await askAgain();
    expect(
      within(row).getByText('Already asked in this request: ACI-LT-005, ACI-LT-006')
    ).toBeInTheDocument();
    fireEvent.click(within(row).getByLabelText('Include Alice Ndom'));
    fireEvent.click(within(row).getByRole('button', { name: 'One that already exists' }));
    fireEvent.click(await screen.findByRole('option', { name: 'A new one' }));
    fireEvent.click(within(row).getByRole('button', { name: 'New device for Alice Ndom' }));
    fireEvent.click(within(lastDialog()).getByRole('button', { name: 'Add device' }));
    await waitFor(() => expect(within(row).getByText('NEW DEVICE')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    row = await askAgain();
    fireEvent.click(within(row).getByLabelText('Include Alice Ndom'));
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const payload = await toReviewAndSubmit();
    const targets = payload.action_groups.flatMap((group) => group.targets);

    expect(payload.action_groups.map((group) => group.operation_code)).toEqual([
      'device.assign',
      'device.assign',
      'device.assign',
      'device.assign',
    ]);
    expect(new Set(payload.action_groups.map((group) => group.group_key)).size).toBe(4);
    expect(targets).toHaveLength(4);
    expect(targets.map((target) => target.subject_key)).toEqual(Array(4).fill('user:CU-001'));
    expect(targets.map((target) => target.managed_device ?? null)).toEqual(['MD-5', 'MD-6', null, null]);
    expect(payload.requested_devices).toHaveLength(1);
    expect(targets[2].device_requirement_key).toBe(payload.requested_devices[0].device_requirement_key);
    expect(targets[3].device_requirement_key ?? null).toBeNull();
  });

  it('puts a Device service on the machine the customer ticks, not on every machine of the person', async () => {
    setUp();
    const onMachine = (device: string, label: string): portal.RequestTarget => ({
      subject_key: 'user:CU-001',
      client_user: 'CU-001',
      requested_client_user: null,
      full_name: 'Alice Ndom',
      department: 'Purchasing',
      target_scope: 'Device',
      managed_device: device,
      device_requirement_key: null,
      requested_device: null,
      device_label: label,
      source_service_assignment: null,
      current_state: null,
    });
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValue({
      customer: 'ACI',
      selected_subject_count: 1,
      domains: [
        {
          key: 'Service' as const,
          label: 'Services',
          options: [
            {
              object_key: 'SOPHOS',
              object_label: 'Sophos',
              service_scope: 'Device',
              current_count: 0,
              without_count: 2,
              actions: [
                {
                  operation_code: 'service.add',
                  operation_label: 'Add',
                  operation_label_snapshot: 'Add Sophos',
                  object_key: 'SOPHOS',
                  object_label: 'Sophos',
                  targets: [onMachine('MD-1', 'ACI-LT-011'), onMachine('MD-2', 'ACI-PH-002')],
                  exclusions: [],
                  applicable_target_count: 2,
                  applicable_subject_count: 1,
                  excluded_subject_count: 0,
                },
              ],
            },
          ],
        },
      ],
    } as never);
    show();
    await addAlice();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    const sophos = (await screen.findByText('Sophos')).closest('tr') as HTMLElement;
    fireEvent.click(within(sophos).getByRole('button', { name: 'Add · 2' }));

    const impact = lastDialog();
    const laptop = within(impact).getByText('ACI-LT-011').closest('tr') as HTMLElement;
    const phone = within(impact).getByText('ACI-PH-002').closest('tr') as HTMLElement;

    expect(within(impact).getAllByLabelText('Include Alice Ndom')).toHaveLength(2);
    fireEvent.click(within(phone).getByLabelText('Include Alice Ndom'));
    expect(within(laptop).getByLabelText('Include Alice Ndom')).toBeChecked();
    fireEvent.click(within(impact).getByRole('button', { name: 'Add action' }));

    const payload = await toReviewAndSubmit();

    expect(payload.action_groups).toHaveLength(1);
    expect(payload.action_groups[0].targets.map((target) => target.managed_device)).toEqual(['MD-1']);
  });
});
