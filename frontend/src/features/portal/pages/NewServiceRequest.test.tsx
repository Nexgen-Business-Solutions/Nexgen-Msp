import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import NewServiceRequest from './NewServiceRequest';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return {
    ...actual,
    getMyApprovalRights: vi.fn(),
    searchRequestUsers: vi.fn(),
    getNewUserRequestContext: vi.fn(),
    getRequestSubmissionContext: vi.fn(),
    getDepartmentSelection: vi.fn(),
    getCompanySelection: vi.fn(),
    evaluateRequestScope: vi.fn(),
    evaluateRequestOperations: vi.fn(),
    createRequest: vi.fn(),
    saveRequestDraft: vi.fn(),
    getRequest: vi.fn(),
  };
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
          client_user: 'CU-001',
          is_new_user: 0 as const,
          full_name: 'Alice Ndom',
          department: 'Purchasing',
          email: 'alice@aci.cm',
          username: null,
          added_via: 'Existing',
          selection_label: null,
          devices: [
            { name: 'MD-1', label: 'ACI-LT-011', status: 'Active' },
            { name: 'MD-2', label: 'ACI-PH-002', status: 'Active' },
            { name: 'MD-3', label: 'ACI-TAB-003', status: 'Active' },
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
            client_user: 'CU-002',
            is_new_user: 0 as const,
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
            client_user: null,
            is_new_user: 1 as const,
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
      full_name: 'Alice Ndom',
      department: 'Purchasing',
      target_scope: 'User',
      managed_device: null,
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

const show = () =>
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <NewServiceRequest />
      </MemoryRouter>
    </QueryClientProvider>
  );

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
  vi.mocked(portal.getNewUserRequestContext).mockResolvedValue({
    customer: 'ACI',
    departments: [{ value: 'Purchasing', label: 'Purchasing' }],
    available_user_services: [],
    available_device_services: [],
    devices: [],
  } as never);
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

const addAlice = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Select existing/ }));
  fireEvent.click((await screen.findAllByRole('button', { name: /^Add$/ }))[0]);
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
    show();
    await addAlice();
    await addAlice();

    expect(await screen.findAllByText('Alice Ndom')).toHaveLength(1);
  });

  it('a new person needs only their full name', async () => {
    setUp();
    show();

    fireEvent.click(screen.getByRole('button', { name: /New user/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add to request' }));

    expect(screen.getByText("Enter the person's full name.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Fresh Face' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to request' }));

    expect(await screen.findByText('NEW')).toBeInTheDocument();
  });

  it('an action reaches the applicable targets and leaves the others alone', async () => {
    setUp();
    show();
    await addAlice();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText('Group actions stay explicit')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'End · 1' }));

    expect(await screen.findByText('End Nextcloud')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 people are applicable.')).toBeInTheDocument();
    expect(screen.getByText('Will apply')).toBeInTheDocument();
    expect(screen.getByText('Left unchanged')).toBeInTheDocument();
    expect(screen.getByLabelText('Include Brice Mvondo')).toBeDisabled();

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

    expect(await screen.findByText('Confirm the exact snapshot and requested actions.')).toBeInTheDocument();
    expect(screen.getByText('People in snapshot')).toBeInTheDocument();
    expect(screen.getByText('Concrete targets')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(portal.createRequest).toHaveBeenCalled());

    const payload = vi.mocked(portal.createRequest).mock.calls[0][0];

    expect(payload.lines).toBeUndefined();
    expect(payload.subjects).toHaveLength(1);
    expect(payload.action_groups).toHaveLength(1);

    const group = payload.action_groups![0];

    expect(group.operation_code).toBe('service.end');
    expect(group.targets).toHaveLength(1);
    expect(group.selected_subject_count).toBe(1);
    expect(group.exclusions[0].reason_code).toBe('NO_CURRENT_ASSIGNMENT');
  });
});
