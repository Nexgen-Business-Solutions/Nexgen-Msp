import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import { usePortalFilters } from '../store/usePortalFilters';
import NewServiceRequest from './NewServiceRequest';

/**
 * Staff raising a request have to say who they are acting for, before anything else.
 *
 * The five ways into the People step each opened their dialog straight away. For staff with
 * no customer chosen that dialog had no company to list people from and nothing to save
 * against: it came up blank, and the page meanwhile complained that no person had been
 * added — true, and not the reason. These hold the one guard that now stands in front of
 * all five, and hold the boundary when staff change company halfway through.
 *
 * Its own file rather than the existing one: that suite fixes the session to a customer
 * account, where `onBehalf` is false and none of this applies.
 */

const pageOf = <T,>(rows: T[]) => ({ rows, total: rows.length, truncated: false });

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return {
    ...actual,
    getMyApprovalRights: vi.fn(),
    searchRequestUsers: vi.fn(),
    getNewPersonContext: vi.fn(),
    getDepartmentSelection: vi.fn(),
    getCompanySelection: vi.fn(),
    evaluateRequestScope: vi.fn(),
    getRequest: vi.fn(),
    getSummary: vi.fn(),
    listSubscribedServices: vi.fn(),
    evaluateRequestOperations: vi.fn(),
    listSelectableClientUsers: vi.fn(),
    listSelectableDevices: vi.fn(),
    getPortalFilterOptions: vi.fn(),
    getRequestSubmissionContext: vi.fn(),
  };
});

vi.mock('@/shared/hooks/useSession', () => ({
  useSession: () => ({ data: { roles: ['MSP System Admin'] } }),
}));

vi.mock('@/features/internal/hooks/useUsers', () => ({
  useUserFilterOptions: () => ({ data: { customers: ['ACI', 'SICG'] } }),
}));

const ACTIONS = ['Existing user', 'Select Device', 'New user', 'Department', 'Entire company'];

const ndom = {
  name: 'CU-001',
  full_name: 'Alice Ndom',
  email: 'alice@aci.cm',
  department: 'Purchasing',
  lifecycle_status: 'Active',
};

const mvondo = {
  name: 'CU-002',
  full_name: 'Brice Mvondo',
  email: 'brice@aci.cm',
  department: 'Purchasing',
  lifecycle_status: 'Active',
};

const selectable = { ...ndom, username: null, selectable: true, disabled_reason: null };
const alsoSelectable = { ...mvondo, username: null, selectable: true, disabled_reason: null };

const renderPage = (at = '/msp/requests/new') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/msp/requests/new" element={<NewServiceRequest />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

/** The server's answer for a whole department or a whole company, in the shape it has. */
const group = (origin: string, label: string) =>
  ({
    customer: 'ACI',
    selection_origin: origin,
    selection_label: label,
    selection_group_key: `${origin.toLowerCase()}:${label}`,
    selection_snapshot_at: '2026-11-11 10:00:00',
    active_count: 1,
    excluded_disabled_count: 0,
    department_count: 1,
    departments: ['Purchasing'],
    people: [ndom],
    excluded: [],
  }) as never;

const selector = () =>
  screen.getByRole('button', { name: /acting for which customer/i });

const chooseCustomer = async (name: string) => {
  fireEvent.click(selector());
  fireEvent.click(await screen.findByRole('option', { name }));
};

beforeEach(() => {
  usePortalFilters.setState({ customer: null });
  vi.mocked(portal.getMyApprovalRights).mockResolvedValue({
    customer: 'ACI',
    has_authority: true,
    can_submit: true,
    can_approve: true,
    department: null,
    awaiting: 0,
  });
  vi.mocked(portal.searchRequestUsers).mockResolvedValue([ndom]);
  vi.mocked(portal.listSelectableClientUsers).mockResolvedValue(
    pageOf([selectable, alsoSelectable])
  );
  vi.mocked(portal.listSelectableDevices).mockResolvedValue(pageOf([]));
  vi.mocked(portal.getDepartmentSelection).mockResolvedValue(group('Department', 'Purchasing'));
  vi.mocked(portal.getCompanySelection).mockResolvedValue(group('Company', 'ACI'));
  vi.mocked(portal.getNewPersonContext).mockResolvedValue({
    customer: 'ACI',
    departments: [{ value: 'Purchasing', label: 'Purchasing' }],
    available_user_services: [],
    available_device_services: [],
  });
  vi.mocked(portal.evaluateRequestScope).mockResolvedValue({ customer: 'ACI', subjects: [] });
  vi.mocked(portal.getSummary).mockResolvedValue({
    customer: 'ACI',
    client_users: 12,
    devices: 4,
  } as never);
  vi.mocked(portal.listSubscribedServices).mockResolvedValue({
    services: [
      {
        service_item: 'ITEM-STORAGE',
        item_name: 'Cloud Storage',
        assignment_scope: 'Customer',
        total: 1,
        active: 1,
        ended: 0,
      },
    ],
    count: 1,
  } as never);
  vi.mocked(portal.evaluateRequestOperations).mockResolvedValue({
    customer: 'ACI',
    selected_subject_count: 0,
    domains: [],
  });
});

afterEach(() => {
  cleanup();
  usePortalFilters.setState({ customer: null });
  vi.clearAllMocks();
});

describe('a customer is named before any of the five actions opens', () => {
  it.each(ACTIONS)('refuses %s and says so where the answer is', async (action) => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: action }));

    const said = await screen.findByRole('alert');

    expect(said).toHaveTextContent('Select a customer first before adding a new user or device.');
    // and no dialog came up behind it
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puts the keyboard on the control the message is about', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New user' }));
    await screen.findByRole('alert');

    expect(document.activeElement).toBe(selector());
  });

  it('ties the message to the control for a screen reader', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New user' }));
    await screen.findByRole('alert');

    expect(selector()).toHaveAttribute('aria-invalid', 'true');
    expect(selector()).toHaveAttribute('aria-describedby', 'customer-required');
  });

  it('does not blame the empty people table while no customer is chosen', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'New user' });

    expect(screen.queryByText(/add at least one person/i)).not.toBeInTheDocument();
  });

  it('asks for the people once a customer is chosen, and stops complaining', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New user' }));
    await screen.findByRole('alert');

    await chooseCustomer('ACI');

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText(/add at least one person/i)).toBeInTheDocument();
  });

  it('opens every action normally once a customer is in hand', async () => {
    renderPage();
    await chooseCustomer('ACI');

    for (const action of ACTIONS) {
      fireEvent.click(screen.getByRole('button', { name: action }));

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  });
});

describe('what was picked for one company never travels to another', () => {
  it('shuts a dialog left open when the company changes under it', async () => {
    renderPage();
    await chooseCustomer('ACI');

    fireEvent.click(screen.getByRole('button', { name: 'Existing user' }));
    await screen.findByRole('dialog');

    await chooseCustomer('SICG');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clears every person picked, not merely the last one', async () => {
    // the clearing used to be a loop of single removals, each reading the list it was
    // rendered with: two people went in and one stayed behind, under the new company
    renderPage();
    await chooseCustomer('ACI');

    fireEvent.click(screen.getByRole('button', { name: 'Existing user' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Alice Ndom' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Brice Mvondo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByText(/add at least one person/i)).not.toBeInTheDocument()
    );

    await chooseCustomer('SICG');

    expect(await screen.findByText(/were cleared when you changed customer/i)).toBeInTheDocument();
    // nothing of the previous company is left on the request
    expect(await screen.findByText(/add at least one person/i)).toBeInTheDocument();
  });

  it('leaves nothing behind when the company is changed and changed back', async () => {
    renderPage();
    await chooseCustomer('ACI');

    fireEvent.click(screen.getByRole('button', { name: 'Existing user' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Alice Ndom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByText(/add at least one person/i)).not.toBeInTheDocument()
    );

    await chooseCustomer('SICG');
    await chooseCustomer('ACI');

    // coming back is a switch like any other: the old selection does not reappear
    expect(await screen.findByText(/add at least one person/i)).toBeInTheDocument();
  });

  it('clears the people of the previous company and says it did', async () => {
    renderPage();
    await chooseCustomer('ACI');

    fireEvent.click(screen.getByRole('button', { name: 'Existing user' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Alice Ndom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // she is on the request now: the page stops asking for somebody
    await waitFor(() =>
      expect(screen.queryByText(/add at least one person/i)).not.toBeInTheDocument()
    );

    await chooseCustomer('SICG');

    expect(await screen.findByText(/were cleared when you changed customer/i)).toBeInTheDocument();
    // and the page is asking again, because nothing is picked for the new company
    expect(await screen.findByText(/add at least one person/i)).toBeInTheDocument();
  });
});

const companyDomain = () => ({
  customer: 'ACI',
  selected_subject_count: 0,
  domains: [
    {
      key: 'Company' as const,
      label: 'The company itself',
      options: [
        {
          object_key: 'ITEM-STORAGE',
          object_label: 'Cloud Storage',
          service_scope: 'Customer',
          current_count: 0,
          without_count: 1,
          actions: [
            {
              operation_code: 'service.add',
              operation_label: 'Add',
              operation_label_snapshot: 'Add Cloud Storage',
              object_key: 'ITEM-STORAGE',
              object_label: 'Cloud Storage',
              targets: [
                {
                  subject_key: 'company',
                  client_user: null,
                  full_name: 'ACI',
                  target_scope: 'Customer' as const,
                  managed_device: null,
                  device_label: null,
                  source_service_assignment: null,
                },
              ],
              exclusions: [],
              applicable_target_count: 1,
              applicable_subject_count: 1,
              excluded_subject_count: 0,
            },
          ],
        },
      ],
    },
  ],
});

describe('a request about the company itself', () => {
  /**
   * A company service names nobody, so such a request has no people in it at all — and the
   * People step would not let anyone past without one.
   */
  it('is added from the same row of buttons as the people and the machines', async () => {
    renderPage();
    await chooseCustomer('ACI');

    const onwards = screen.getByRole('button', { name: /continue/i });

    expect(onwards).toBeDisabled();
    expect(screen.getByText('Add at least one person before continuing.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Company itself' }));

    // it sits in the same table as everybody else, with what the company holds
    const row = (await screen.findByText('COMPANY')).closest('tr') as HTMLElement;

    expect(within(row).getByText('ACI')).toBeInTheDocument();
    expect(await screen.findByText('Cloud Storage')).toBeInTheDocument();
    expect(
      within(row).getByText('12 people · 4 Devices · nobody carries these')
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    );
    expect(screen.getByText(/This request is about the company itself/)).toBeInTheDocument();
  });

  it('is taken off the request again, like a person', async () => {
    renderPage();
    await chooseCustomer('ACI');

    fireEvent.click(screen.getByRole('button', { name: 'Company itself' }));
    expect(await screen.findByText('COMPANY')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove ACI' }));

    await waitFor(() => expect(screen.queryByText('COMPANY')).not.toBeInTheDocument());
    expect(screen.getByText('Add at least one person before continuing.')).toBeInTheDocument();
  });

  /**
   * The acts of a scope were only ever asked for once somebody was selected, so a request
   * about the company reached this step and found it empty: the service it is entirely
   * about was never offered. This holds the real hook, not a stand-in for it.
   */
  it('offers the company its own services with nobody selected', async () => {
    vi.mocked(portal.evaluateRequestOperations).mockResolvedValue(companyDomain() as never);
    renderPage();
    await chooseCustomer('ACI');

    fireEvent.click(screen.getByRole('button', { name: 'Company itself' }));
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

    // the company is the scope the step opens on, since nobody else is on the request
    expect(await screen.findByText('Nobody is named on these')).toBeInTheDocument();
    expect(vi.mocked(portal.evaluateRequestOperations).mock.calls[0][0]).toMatchObject({
      subject_keys: [],
    });

    fireEvent.change(await screen.findByLabelText('How much of Cloud Storage'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // the act is on the request now, so the step has something to go on with
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    );
  });
});

describe('a draft is worked on for the company it was written for', () => {
  /**
   * The selector stayed live on a reopened draft, and the two effects behind it answered
   * each other: changing company cleared everything picked, then the draft's own company
   * was put back. The request came back to where it started, emptied.
   */
  const draft = {
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
    action_groups: [],
  } as never;

  it('does not offer to act for another company, and says which one it is for', async () => {
    vi.mocked(portal.getRequest).mockResolvedValue(draft);
    renderPage('/msp/requests/new?draft=SR-D');

    expect(await screen.findByText('Alice Ndom')).toBeInTheDocument();
    expect(
      screen.getByText('This request was written for ACI. Raise a new one to act for another company.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /acting for which customer/i })
    ).not.toBeInTheDocument();
    // and nothing was cleared, because nothing could be switched
    expect(screen.queryByText(/were cleared when you changed customer/i)).not.toBeInTheDocument();
  });
});
