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
    getRequestSubjectContext: vi.fn(),
    getNewUserRequestContext: vi.fn(),
    getRequestSubmissionContext: vi.fn(),
    createRequest: vi.fn(),
    getRequest: vi.fn(),
    saveRequestDraft: vi.fn(),
  };
});

vi.mock('@/shared/hooks/useSession', () => ({
  useSession: () => ({ data: { roles: ['MSP Customer Manager'] } }),
}));

vi.mock('@/features/internal/hooks/useUsers', () => ({
  useUserFilterOptions: () => ({ data: { customers: [] } }),
}));

const addAction = {
  name: 'Grant a service',
  title: 'Grant a service',
  action_type: 'Add',
  description: null,
};
const suspendAction = {
  name: 'Suspend a service',
  title: 'Temporarily suspend',
  action_type: 'Suspend',
  description: null,
};
const removeAction = {
  name: 'Remove a service',
  title: 'Terminate service',
  action_type: 'Remove',
  description: null,
};

const john = {
  name: 'CU-001',
  full_name: 'John Doe',
  email: 'john@acme.com',
  department: 'Accounting',
  lifecycle_status: 'Active',
};

const subjectContext: portal.RequestSubjectContext = {
  user: { ...john, customer: 'ACME' },
  personal_services: {
    current: [
      {
        assignment: 'SA-001',
        service_item: 'M365',
        label: 'Microsoft 365',
        status: 'Active',
        since: '2026-01-10',
        quantity: 1,
        managed_device: null,
        hostname: null,
        pending_request: null,
        allowed_request_actions: [suspendAction, removeAction],
      },
    ],
    available: [
      {
        service_item: 'ADOBE',
        item_name: 'Adobe Acrobat',
        service_scope: 'User',
        allowed_request_actions: [addAction],
      },
    ],
  },
  target_reason: null,
  devices: [
    {
      name: 'DEV-001',
      hostname: 'LAPTOP-JDOE',
      serial_number: 'ABC-493022',
      device_type: 'Laptop',
      status: 'Active',
      assigned_date: '2026-06-04',
      target_reason: null,
      services: {
        current: [
          {
            assignment: 'SA-002',
            service_item: 'SOPHOS',
            label: 'Sophos Endpoint',
            status: 'Active',
            since: '2026-02-01',
            quantity: 1,
            managed_device: 'DEV-001',
            hostname: 'LAPTOP-JDOE',
            pending_request: null,
            allowed_request_actions: [suspendAction, removeAction],
          },
        ],
        available: [
          {
            service_item: 'RMM',
            item_name: 'RMM',
            service_scope: 'Device',
            allowed_request_actions: [addAction],
          },
        ],
      },
    },
  ],
};

const renderPage = async (
  context: portal.RequestSubjectContext = subjectContext,
  entry = '/msp/requests/new'
) => {
  vi.mocked(portal.getMyApprovalRights).mockResolvedValue({
    customer: 'ACME',
    has_authority: false,
    can_submit: true,
    can_approve: false,
    department: null,
    awaiting: 0,
  } as unknown as Awaited<ReturnType<typeof portal.getMyApprovalRights>>);
  vi.mocked(portal.searchRequestUsers).mockResolvedValue([john]);
  vi.mocked(portal.getRequestSubjectContext).mockResolvedValue(context);
  vi.mocked(portal.getNewUserRequestContext).mockResolvedValue({
    customer: 'ACME',
    departments: [{ value: 'Human Resources', label: 'Human Resources' }],
    available_user_services: [
      {
        service_item: 'M365',
        item_name: 'Microsoft 365',
        service_scope: 'User',
        allowed_request_actions: [addAction],
      },
    ],
    available_device_services: [
      {
        service_item: 'SOPHOS',
        item_name: 'Sophos Endpoint',
        service_scope: 'Device',
        allowed_request_actions: [addAction],
      },
    ],
  });
  vi.mocked(portal.getRequestSubmissionContext).mockResolvedValue({
    customer: 'ACME',
    may_submit: true,
    needs_customer_approval: true,
    message: 'This request will first wait for approval inside your company.',
  });
  vi.mocked(portal.createRequest).mockResolvedValue({
    name: 'SR-2026-0001',
  } as unknown as Awaited<ReturnType<typeof portal.createRequest>>);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <NewServiceRequest />
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('New request');
};

const renderPageWithParams = async (search: string) => {
  vi.mocked(portal.getMyApprovalRights).mockResolvedValue({
    customer: 'ACME',
    has_authority: false,
    can_submit: true,
    can_approve: false,
    department: null,
    awaiting: 0,
  } as unknown as Awaited<ReturnType<typeof portal.getMyApprovalRights>>);
  vi.mocked(portal.getRequestSubmissionContext).mockResolvedValue({
    customer: 'ACME',
    may_submit: true,
    needs_customer_approval: false,
    message: 'This request will be sent to Nexgen for review.',
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/msp/requests/new${search}`]}>
        <NewServiceRequest />
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('New request');
};

const pickJohn = async () => {
  fireEvent.change(screen.getByPlaceholderText(/search a user/i), {
    target: { value: 'John' },
  });
  fireEvent.click(await screen.findByText('John Doe'));
};

const goToChanges = async () => {
  await pickJohn();
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText('Personal services');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the request builder walks four steps', () => {
  it('will not leave the first step until somebody is chosen', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

    await pickJohn();

    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('shows the person as they stand: who they are, what they hold and since when', async () => {
    await renderPage({
      ...subjectContext,
      user: { ...subjectContext.user, username: 'j.doe', start_date: '2025-02-18' },
    });
    await pickJohn();

    expect(await screen.findByText('LAPTOP-JDOE')).toBeInTheDocument();
    for (const [label, value] of [
      ['Department', 'Accounting'],
      ['Email', 'john@acme.com'],
      ['Username', 'j.doe'],
      ['Start Date', '2025-02-18'],
      ['Serial Number', 'ABC-493022'],
      ['In Service Since', '2026-06-04'],
    ]) {
      expect(screen.getByText(label).nextSibling).toHaveTextContent(value);
    }
    expect(screen.getByText('Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText(/Sophos Endpoint since 2026-02-01/)).toBeInTheDocument();
    expect(screen.queryByText(/open requests/i)).not.toBeInTheDocument();
  });

  it('offers no free service, action or scope dropdown', async () => {
    await renderPage();
    await goToChanges();

    expect(screen.queryByText(/^scope$/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/select service/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/select an action/i)).not.toBeInTheDocument();
  });
});

describe('acts are embedded with the service they belong to', () => {
  it('offers only what a running service can receive, named by the administrator', async () => {
    await renderPage();
    await goToChanges();

    const row = screen.getByText('Microsoft 365').closest('div')?.parentElement as HTMLElement;

    // removing it is on show, the rest waits behind the dots
    expect(within(row).getByRole('button', { name: 'Terminate service' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Temporarily suspend' })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByTitle('More options'));

    expect(await screen.findByRole('button', { name: 'Temporarily suspend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^resume/i })).not.toBeInTheDocument();
  });

  it('turns one click into one intention, and lets it be taken back', async () => {
    await renderPage();
    await goToChanges();

    fireEvent.click(screen.getByRole('button', { name: /Adobe Acrobat/ }));

    expect(await screen.findByRole('button', { name: /Adobe Acrobat — added/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Adobe Acrobat — added/ }));

    expect(screen.getByRole('button', { name: /^\s*Adobe Acrobat$/ })).toBeInTheDocument();
  });

  it('keeps a device service under its own machine', async () => {
    await renderPage();
    await goToChanges();

    const deviceCard = screen.getByText('LAPTOP-JDOE').closest('div')?.parentElement;

    expect(within(deviceCard as HTMLElement).getByText('Sophos Endpoint')).toBeInTheDocument();
    expect(within(deviceCard as HTMLElement).getByRole('button', { name: /RMM/ })).toBeInTheDocument();
  });
});

describe('sending what was asked for', () => {
  it('sends one line per intention, each naming its own target', async () => {
    await renderPage();
    await goToChanges();

    const m365 = screen.getByText('Microsoft 365').closest('div')?.parentElement as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: /Adobe Acrobat/ }));
    fireEvent.click(within(m365).getByTitle('More options'));
    fireEvent.click(await screen.findByRole('button', { name: 'Temporarily suspend' }));
    fireEvent.click(screen.getByRole('button', { name: /RMM/ }));

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/what you are asking for/i);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/after submission/i);

    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(portal.createRequest).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(portal.createRequest).mock.calls[0][0];
    expect(payload.lines).toHaveLength(3);

    const adobe = payload.lines.find((line) => line.requested_service === 'ADOBE');
    expect(adobe).toMatchObject({ target_scope: 'User', client_user: 'CU-001', action: 'Add' });
    expect(adobe?.source_service_assignment).toBeUndefined();

    const suspend = payload.lines.find((line) => line.requested_service === 'M365');
    expect(suspend).toMatchObject({
      action: 'Suspend',
      source_service_assignment: 'SA-001',
      client_user: 'CU-001',
    });

    const rmm = payload.lines.find((line) => line.requested_service === 'RMM');
    expect(rmm).toMatchObject({
      target_scope: 'Device',
      managed_device: 'DEV-001',
      requested_for_user: 'CU-001',
    });
    expect(rmm?.client_user).toBeUndefined();
  });

  it('carries one note for the whole request, and none on any line', async () => {
    await renderPage();
    await goToChanges();

    fireEvent.click(screen.getByRole('button', { name: /Adobe Acrobat/ }));
    fireEvent.click(screen.getByRole('button', { name: /RMM/ }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/what you are asking for/i);

    expect(screen.queryByRole('button', { name: /add details/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: 'Details' })).toHaveLength(1);

    fireEvent.change(screen.getByRole('textbox', { name: 'Details' }), {
      target: { value: 'Please call before coming on site.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/please call before coming on site/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(portal.createRequest).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(portal.createRequest).mock.calls[0][0];
    expect(payload.details).toBe('Please call before coming on site.');
    expect(payload.lines.every((line) => !('comment' in line) || !line.comment)).toBe(true);
  });

  it('tells the customer what happens after they send it', async () => {
    await renderPage();
    await goToChanges();

    fireEvent.click(screen.getByRole('button', { name: /Adobe Acrobat/ }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/what you are asking for/i);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(
      await screen.findByText(/wait for approval inside your company/i)
    ).toBeInTheDocument();
  });
});

describe('a person who does not exist yet', () => {
  it('requires only a name and a department, and offers the account name as optional', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));

    expect(await screen.findByPlaceholderText('Marie Dupont')).toBeInTheDocument();
    expect(screen.getByText('Department')).toBeInTheDocument();
    // offered, never demanded: the customer who knows it may say so
    expect(screen.getByText('Username (optional)')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/leave empty if you do not know it/i)
    ).toBeInTheDocument();
  });

  it('says a technician will settle the machine for a device service', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(await screen.findByPlaceholderText('Marie Dupont'), {
      target: { value: 'Marie Dupont' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.click(await screen.findByRole('button', { name: /Sophos Endpoint/ }));

    expect(
      await screen.findByText(/a technician will prepare or identify it/i)
    ).toBeInTheDocument();
  });
});

describe('picking up what was put aside', () => {
  const savedDraft = {
    name: 'SR-DRAFT-1',
    customer: 'ACME',
    request_type: 'Add',
    status: 'Draft',
    priority: 'High',
    source: 'Portal',
    creation: '2026-09-01 10:00:00',
    modified: '2026-09-01 10:00:00',
    requester: 'john@acme.com',
    lines: [
      {
        idx: 1,
        action: 'Add',
        line_status: 'Pending',
        rejection_reason: null,
        is_new_user: 0,
        new_user_full_name: null,
        new_user_department: null,
        is_new_device: 0,
        new_device_label: null,
        user_name: 'John Doe',
        department: 'Accounting',
        username: null,
        service_name: 'Adobe Acrobat',
        action_label: 'Grant a service',
        hostname: null,
        serial_number: null,
        device_type: null,
        device_holder: null,
        requested_effective_date: '2026-09-15',
        comment: null,
        service_status: null,
        service_start_date: null,
        delivered_on: null,
        request_action: 'Grant a service',
        target_scope: 'User',
        service_scope: 'User',
        client_user: 'CU-001',
        managed_device: null,
        source_service_assignment: null,
        requested_for_user: 'CU-001',
        requested_quantity: 1,
        requested_service: 'ADOBE',
        new_user_email: null,
        new_user_username: null,
        new_device_type: null,
        new_device_serial: null,
      },
    ],
  };

  it('rebuilds the person and what was asked for', async () => {
    vi.mocked(portal.getRequest).mockResolvedValue(
      savedDraft as unknown as Awaited<ReturnType<typeof portal.getRequest>>
    );

    await renderPageWithParams('?draft=SR-DRAFT-1');

    expect(await screen.findByText('John Doe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('button', { name: /Adobe Acrobat — added/ })).toBeInTheDocument();
  });

  it('gathers what an older draft noted line by line into the one note', async () => {
    vi.mocked(portal.getRequest).mockResolvedValue({
      ...savedDraft,
      lines: [{ ...savedDraft.lines[0], comment: 'Needs the Pro licence.' }],
    } as unknown as Awaited<ReturnType<typeof portal.getRequest>>);

    await renderPageWithParams('?draft=SR-DRAFT-1');
    expect(await screen.findByText('John Doe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByRole('button', { name: /Adobe Acrobat — added/ });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('textbox', { name: 'Details' })).toHaveValue('Needs the Pro licence.');
  });

  it('flags an item the world has moved past', async () => {
    vi.mocked(portal.getRequest).mockResolvedValue(
      savedDraft as unknown as Awaited<ReturnType<typeof portal.getRequest>>
    );
    // somebody else granted Adobe while the draft sat there
    vi.mocked(portal.getRequestSubjectContext).mockResolvedValue({
      ...subjectContext,
      personal_services: {
        current: [
          {
            assignment: 'SA-009',
            service_item: 'ADOBE',
            label: 'Adobe Acrobat',
            status: 'Active',
            since: '2026-09-03',
            quantity: 1,
            managed_device: null,
            hostname: null,
            pending_request: null,
            allowed_request_actions: [suspendAction],
          },
        ],
        available: [],
      },
    });

    await renderPageWithParams('?draft=SR-DRAFT-1');
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

    expect(
      await screen.findByText(/no longer available because Adobe Acrobat is now active/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove it/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('button', { name: /submit request/i })).toBeDisabled();
  });

  it('shows a load failure instead of spinning forever', async () => {
    vi.mocked(portal.getRequest).mockRejectedValue(new Error('The saved request could not be read.'));

    await renderPageWithParams('?draft=SR-DRAFT-1');

    expect(await screen.findByText('The saved request could not be read.')).toBeInTheDocument();
    expect(screen.queryByText(/reading what was put aside/i)).not.toBeInTheDocument();
  });
});

describe('what the screen must never hide', () => {
  it('says when a service is already being changed, and offers nothing further', async () => {
    await renderPage({
      ...subjectContext,
      personal_services: {
        current: [
          {
            ...subjectContext.personal_services.current[0],
            pending_request: 'SR-2026-0014',
            allowed_request_actions: [],
          },
        ],
        available: [],
      },
      devices: [],
    });
    await goToChanges();

    expect(await screen.findByText(/already requested — SR-2026-0014/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Temporarily suspend' })).not.toBeInTheDocument();
  });

  it('gives every machine its own card, each with its serial', async () => {
    await renderPage({
      ...subjectContext,
      devices: [
        subjectContext.devices[0],
        {
          ...subjectContext.devices[0],
          name: 'DEV-002',
          hostname: 'PHONE-JDOE',
          serial_number: 'IPH92812',
          device_type: 'Phone',
          services: { current: [], available: [] },
        },
      ],
    });
    await goToChanges();

    expect(await screen.findByText('LAPTOP-JDOE')).toBeInTheDocument();
    expect(screen.getByText(/Serial: ABC-493022/)).toBeInTheDocument();
    expect(screen.getByText('PHONE-JDOE')).toBeInTheDocument();
    expect(screen.getByText(/Serial: IPH92812/)).toBeInTheDocument();
  });

  it('tells a person with no machine that a technician will settle it', async () => {
    await renderPage({ ...subjectContext, devices: [] });
    await goToChanges();

    expect(
      await screen.findByText(/No device currently assigned to John Doe/i)
    ).toBeInTheDocument();
  });
});

describe('technical details are offered, never demanded', () => {
  const reachSchedule = async () => {
    await renderPage({ ...subjectContext, devices: [] });
    await goToChanges();
    fireEvent.click(screen.getByRole('button', { name: /Adobe Acrobat/ }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/what you are asking for/i);
  };

  it('lets a request through with none of them filled in', async () => {
    await reachSchedule();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/after submission/i);

    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(portal.createRequest).toHaveBeenCalledTimes(1));

    const line = vi.mocked(portal.createRequest).mock.calls[0][0].lines[0];
    expect(line.new_user_username).toBeUndefined();
    expect(line.new_device_serial).toBeUndefined();
    expect(line.new_device_label).toBeUndefined();
  });

  it('carries the account name a customer did know', async () => {
    await renderPage({ ...subjectContext, devices: [] });

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(await screen.findByPlaceholderText('Marie Dupont'), {
      target: { value: 'Marie Dupont' },
    });
    fireEvent.change(screen.getByPlaceholderText(/leave empty if you do not know it/i), {
      target: { value: 'm.dupont' },
    });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Microsoft 365/ }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/what you are asking for/i);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/after submission/i);
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(portal.createRequest).toHaveBeenCalledTimes(1));

    const line = vi.mocked(portal.createRequest).mock.calls[0][0].lines[0];
    expect(line.new_user_username).toBe('m.dupont');
  });

  it('carries the hostname and serial a customer did know about a machine', async () => {
    await renderPage({ ...subjectContext, devices: [] });

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(await screen.findByPlaceholderText('Marie Dupont'), {
      target: { value: 'Marie Dupont' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sophos Endpoint/ }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.change(await screen.findByLabelText(/hostname \(optional\)/i), {
      target: { value: 'LAPTOP-MDUPONT' },
    });
    fireEvent.change(screen.getByLabelText(/serial number \(optional\)/i), {
      target: { value: 'SN-9912' },
    });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/after submission/i);
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(portal.createRequest).toHaveBeenCalledTimes(1));

    const line = vi.mocked(portal.createRequest).mock.calls[0][0].lines[0];
    expect(line.is_new_device).toBe(1);
    expect(line.new_device_label).toBe('LAPTOP-MDUPONT');
    expect(line.new_device_serial).toBe('SN-9912');
  });
});

describe('a person with no machine', () => {
  const sophos = {
    service_item: 'SOPHOS',
    item_name: 'Sophos Endpoint',
    service_scope: 'Device',
    allowed_request_actions: [addAction],
  };
  const noMachine = (overrides: Partial<portal.RequestSubjectContext> = {}) => ({
    ...subjectContext,
    devices: [],
    new_device_services: [sophos],
    assignable_devices: [],
    ...overrides,
  });

  const submitted = async () => {
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/what you are asking for/i);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/after submission/i);
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
    await waitFor(() => expect(portal.createRequest).toHaveBeenCalledTimes(1));

    return vi.mocked(portal.createRequest).mock.calls[0][0].lines[0];
  };

  it('is still offered the machine services of the contract', async () => {
    await renderPage(noMachine());
    await goToChanges();

    expect(await screen.findByRole('button', { name: /Sophos Endpoint/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /existing device/i })).not.toBeInTheDocument();
  });

  it('offers two choices, and leaving both alone is the default', async () => {
    await renderPage(noMachine());
    await goToChanges();

    expect(await screen.findByRole('radio', { name: /a new machine/i })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /not specified/i })).not.toBeInTheDocument();
    expect(screen.getByText('A technician will prepare or identify the device.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /a new machine/i }));
    expect(screen.getByText(/prepare a new device/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /a new machine/i }));
    expect(screen.getByText('A technician will prepare or identify the device.')).toBeInTheDocument();
  });

  it('left unsaid, the machine is one the technician prepares', async () => {
    await renderPage(noMachine());
    await goToChanges();
    fireEvent.click(await screen.findByRole('button', { name: /Sophos Endpoint/ }));

    const line = await submitted();

    expect(line).toMatchObject({
      requested_service: 'SOPHOS',
      target_scope: 'User',
      is_new_device: 1,
      requested_for_user: 'CU-001',
    });
    expect(line.managed_device).toBeUndefined();
    expect(line.new_device_label).toBeUndefined();
  });

  it('carries the machine from stock the customer picked', async () => {
    await renderPage(
      noMachine({
        assignable_devices: [
          {
            name: 'DEV-9',
            hostname: 'LAPTOP-STOCK',
            serial_number: 'SN-9',
            device_type: 'Laptop',
            status: 'Stock',
            assigned_client_user: null,
            holder_name: null,
          },
        ],
      })
    );
    await goToChanges();

    fireEvent.click(await screen.findByRole('radio', { name: /existing device/i }));
    fireEvent.click(screen.getByRole('button', { name: /search a hostname or a serial/i }));
    fireEvent.click(await screen.findByRole('option', { name: /LAPTOP-STOCK/ }));
    fireEvent.click(screen.getByRole('button', { name: /Sophos Endpoint/ }));

    const line = await submitted();

    expect(line).toMatchObject({
      is_new_device: 1,
      new_device_label: 'LAPTOP-STOCK',
      new_device_serial: 'SN-9',
      new_device_type: 'Laptop',
    });
  });

  const held = {
    name: 'DEV-7',
    hostname: 'LAPTOP-JANE',
    serial_number: 'SN-7',
    device_type: 'Laptop',
    status: 'Active',
    assigned_client_user: 'CU-002',
    holder_name: 'Jane Roe',
  };

  it('asks before suggesting a machine somebody else holds, then carries it', async () => {
    await renderPage(noMachine({ assignable_devices: [held] }));
    await goToChanges();

    fireEvent.click(await screen.findByRole('radio', { name: /existing device/i }));
    fireEvent.click(screen.getByRole('button', { name: /search a hostname or a serial/i }));
    fireEvent.click(await screen.findByRole('option', { name: /LAPTOP-JANE/ }));

    expect(await screen.findByText(/LAPTOP-JANE is held by Jane Roe/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm transfer/i }));
    expect(await screen.findByText(/transfer LAPTOP-JANE from Jane Roe/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sophos Endpoint/ }));

    const line = await submitted();

    expect(line).toMatchObject({ is_new_device: 1, new_device_label: 'LAPTOP-JANE', new_device_serial: 'SN-7' });
    expect(line.managed_device).toBeUndefined();
  });

  it('keeps nothing when the customer does not confirm the transfer', async () => {
    await renderPage(noMachine({ assignable_devices: [held] }));
    await goToChanges();

    fireEvent.click(await screen.findByRole('radio', { name: /existing device/i }));
    fireEvent.click(screen.getByRole('button', { name: /search a hostname or a serial/i }));
    fireEvent.click(await screen.findByRole('option', { name: /LAPTOP-JANE/ }));
    // the close cross and the button both say Cancel, and both leave the machine unsuggested
    fireEvent.click(within(await screen.findByRole('dialog')).getAllByRole('button', { name: /cancel/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Sophos Endpoint/ }));

    const line = await submitted();

    expect(line.new_device_label).toBeUndefined();
  });
});

describe('starting from a machine', () => {
  it('a held machine starts the request about whoever holds it', async () => {
    await renderPage(subjectContext, '/msp/requests/new?client_user=CU-001');

    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('a machine nobody holds starts it about somebody new, who can still be changed', async () => {
    await renderPage(subjectContext, '/msp/requests/new?new_user=1');

    expect(await screen.findByPlaceholderText('Marie Dupont')).toBeInTheDocument();
    expect(screen.getByText(/Person/)).toBeInTheDocument();
  });
});
