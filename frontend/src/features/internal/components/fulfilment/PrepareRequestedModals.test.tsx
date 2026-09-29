import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import * as internal from '@/lib/api/internal';
import type { ExecutionPlan } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import PrepareRequestedClientUserModal from './PrepareRequestedClientUserModal';
import PrepareRequestedDeviceModal from './PrepareRequestedDeviceModal';

const pageOf = <T,>(rows: T[]) => ({ rows, total: rows.length, truncated: false });

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    saveRequestedClientUser: vi.fn(),
    resolveRequestedClientUser: vi.fn(),
    listSelectableClientUsers: vi.fn(),
    saveRequestedDevice: vi.fn(),
    resolveRequestedDevice: vi.fn(),
    listSelectableDevices: vi.fn(),
    listDepartmentOptions: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
  };
});

const planStub = { request: 'SR-0001' } as ExecutionPlan;

const person = (overrides: Partial<RequestedEntityPresentation> = {}): RequestedEntityPresentation => ({
  kind: 'client_user',
  name: 'RCU-1',
  key: 'new:marie',
  display_name: 'Marie Dupont',
  context_label: 'Requested Client User',
  status: 'Open',
  readiness: 'needs_review',
  badge: 'NEEDS REVIEW',
  resolved_to: null,
  requested_snapshot: { full_name: 'Marie Dupont', department: null, email: 'marie@acme.com', username: null },
  prepared_values: {},
  requested_work_count: 2,
  relationship_summary: [],
  ...overrides,
});

const laptop = (overrides: Partial<RequestedEntityPresentation> = {}): RequestedEntityPresentation => ({
  kind: 'device',
  name: 'RDEV-1',
  key: 'new-device:1',
  display_name: 'New laptop',
  context_label: 'Requested Device',
  status: 'Open',
  readiness: 'needs_review',
  badge: 'UNRESOLVED',
  resolved_to: null,
  requested_snapshot: { display_label: 'New laptop', device_type: 'Laptop', hostname: null, serial_number: null },
  prepared_values: {},
  requested_work_count: 3,
  relationship_summary: [],
  ...overrides,
});

const show = (element: ReactElement) => {
  vi.mocked(internal.listDepartmentOptions).mockResolvedValue([
    { value: 'Purchasing', label: 'Purchasing' },
    { value: 'Finance', label: 'Finance' },
  ]);
  vi.mocked(internal.getDeviceFilterOptions).mockResolvedValue({
    device_types: ['Laptop', 'Desktop'],
    interface_types: [],
    statuses: [],
    customers: [],
  } as unknown as Awaited<ReturnType<typeof internal.getDeviceFilterOptions>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return screen.getByRole('dialog');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Prepare requested Client User', () => {
  it('shows the exact copy, the frozen requested information and both tabs', () => {
    const dialog = show(
      <PrepareRequestedClientUserModal entity={person()} customer="ACME" onClose={vi.fn()} onSaved={vi.fn()} />
    );

    expect(within(dialog).getByText('Prepare requested Client User')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Review what the requester provided, complete what you know, then resolve this requested person by creating a new Client User or selecting an existing one.'
      )
    ).toBeInTheDocument();
    const asked = within(dialog).getByRole('region', { name: 'Requested information' });
    expect(within(asked).getByText('Marie Dupont')).toBeInTheDocument();
    expect(within(asked).getByText('marie@acme.com')).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Create new' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tab', { name: 'Use existing' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Full name' })).toBeInTheDocument();
    for (const field of ['Email', 'Username', 'Start date']) {
      expect(within(dialog).getByLabelText(field)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText('External employee ID')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Department')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Only fields required to create the Client User block resolution. Service-specific requirements remain on dependent work.'
      )
    ).toBeInTheDocument();
    for (const button of ['Cancel', 'Save progress', 'Save & resolve']) {
      expect(within(dialog).getByRole('button', { name: button })).toBeInTheDocument();
    }
  });

  it('enables Save & resolve only once the full name and the department are present', async () => {
    vi.mocked(internal.resolveRequestedClientUser).mockResolvedValue({ entity: person(), plan: planStub });
    const onClose = vi.fn();
    const dialog = show(
      <PrepareRequestedClientUserModal entity={person()} customer="ACME" onClose={onClose} onSaved={vi.fn()} />
    );

    const resolve = within(dialog).getByRole('button', { name: 'Save & resolve' });
    expect(resolve).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Select a department' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Purchasing' }));
    expect(resolve).toBeEnabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Full name' }), { target: { value: ' ' } });
    expect(resolve).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Full name' }), { target: { value: 'Marie F. Dupont' } });
    fireEvent.click(resolve);

    await waitFor(() =>
      expect(internal.resolveRequestedClientUser).toHaveBeenCalledWith({
        name: 'RCU-1',
        mode: 'create',
        values: {
          full_name: 'Marie F. Dupont',
          department: 'Purchasing',
          email: 'marie@acme.com',
          username: null,
          start_date: null,
        },
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('saves progress through the save endpoint and keeps the values in the modal', async () => {
    vi.mocked(internal.saveRequestedClientUser).mockResolvedValue({ entity: person(), plan: planStub });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const dialog = show(
      <PrepareRequestedClientUserModal entity={person()} customer="ACME" onClose={onClose} onSaved={onSaved} />
    );

    fireEvent.change(within(dialog).getByLabelText('Username'), { target: { value: 'mdupont' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));

    await waitFor(() =>
      expect(internal.saveRequestedClientUser).toHaveBeenCalledWith({
        name: 'RCU-1',
        values: expect.objectContaining({ full_name: 'Marie Dupont', username: 'mdupont', email: 'marie@acme.com' }),
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Username')).toHaveValue('mdupont');
    expect(within(dialog).getByRole('textbox', { name: 'Full name' })).toHaveValue('Marie Dupont');
  });

  it('lists every Client User of the customer, disabled and archived greyed and unselectable, nothing chosen for you', async () => {
    vi.mocked(internal.listSelectableClientUsers).mockResolvedValue(pageOf([
      { name: 'CU-1', full_name: 'Alice Ndom', department: 'Purchasing', username: 'alice', email: null, lifecycle_status: 'Active', selectable: true, disabled_reason: null },
      { name: 'CU-2', full_name: 'Paul Ebong', department: 'Operations', username: 'paul', email: null, lifecycle_status: 'Disabled', selectable: false, disabled_reason: 'This record is disabled and cannot be selected.' },
      { name: 'CU-3', full_name: 'Old Timer', department: null, username: null, email: null, lifecycle_status: 'Archived', selectable: false, disabled_reason: 'This record is disabled and cannot be selected.' },
      { name: 'CU-4', full_name: 'Marie Dupont', department: 'Purchasing', username: null, email: 'marie@acme.com', lifecycle_status: 'Pending', selectable: true, disabled_reason: null },
    ]));
    vi.mocked(internal.resolveRequestedClientUser).mockResolvedValue({ entity: person(), plan: planStub });
    const dialog = show(
      <PrepareRequestedClientUserModal entity={person()} customer="ACME" onClose={vi.fn()} onSaved={vi.fn()} />
    );

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing' }));
    expect(within(dialog).getByPlaceholderText('Name, email, username…')).toBeInTheDocument();
    await within(dialog).findByRole('radio', { name: 'Alice Ndom' });

    expect(internal.listSelectableClientUsers).toHaveBeenCalledWith('ACME', undefined, expect.anything());
    const radios = within(dialog).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(within(dialog).getByRole('radio', { name: 'Paul Ebong' })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: 'Old Timer' })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: 'Alice Ndom' })).toBeEnabled();
    expect(within(dialog).getByRole('radio', { name: 'Marie Dupont' })).toBeEnabled();
    expect(within(dialog).getByText('DISABLED')).toBeInTheDocument();
    expect(within(dialog).getByText('ARCHIVED')).toBeInTheDocument();
    expect(within(dialog).getByText('Operations · paul')).toBeInTheDocument();
    expect(within(dialog).getByText('No department · No username')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radio', { name: 'Paul Ebong' }).closest('label')
    ).toHaveAttribute('data-selectable', 'false');

    const resolve = within(dialog).getByRole('button', { name: 'Save & resolve' });
    expect(resolve).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save progress' })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Marie Dupont' }));
    fireEvent.click(resolve);
    await waitFor(() =>
      expect(internal.resolveRequestedClientUser).toHaveBeenCalledWith({
        name: 'RCU-1',
        mode: 'existing',
        client_user: 'CU-4',
      })
    );
  });

  it('searches once the typing pauses for 300 ms, and says when the list is cut', async () => {
    vi.mocked(internal.listSelectableClientUsers).mockResolvedValue({
      rows: [
        { name: 'CU-1', full_name: 'Alice Ndom', department: 'Purchasing', username: 'alice', email: null, lifecycle_status: 'Active', selectable: true, disabled_reason: null },
      ],
      total: 75,
      truncated: true,
    });
    const dialog = show(
      <PrepareRequestedClientUserModal entity={person()} customer="ACME" onClose={vi.fn()} onSaved={vi.fn()} />
    );

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing' }));
    expect(await within(dialog).findByText('Showing the first 1 of 75. Refine your search.')).toBeInTheDocument();
    const calls = vi.mocked(internal.listSelectableClientUsers).mock.calls.length;

    fireEvent.change(within(dialog).getByPlaceholderText('Name, email, username…'), { target: { value: 'ali' } });
    await new Promise((done) => setTimeout(done, 150));
    expect(internal.listSelectableClientUsers).toHaveBeenCalledTimes(calls);

    await waitFor(() =>
      expect(internal.listSelectableClientUsers).toHaveBeenLastCalledWith('ACME', 'ali', expect.anything())
    );
    expect(internal.listSelectableClientUsers).toHaveBeenCalledTimes(calls + 1);
  });

  it('shows a conflicting resolution with its exact copy', async () => {
    vi.mocked(internal.listSelectableClientUsers).mockResolvedValue(pageOf([
      { name: 'CU-1', full_name: 'Alice Ndom', department: 'Purchasing', username: 'alice', email: null, lifecycle_status: 'Active', selectable: true, disabled_reason: null },
    ]));
    vi.mocked(internal.resolveRequestedClientUser).mockRejectedValue(
      new Error('This requested target has already been resolved to a different record. Refresh the request before continuing.')
    );
    const onClose = vi.fn();
    const dialog = show(
      <PrepareRequestedClientUserModal entity={person()} customer="ACME" onClose={onClose} onSaved={vi.fn()} />
    );

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing' }));
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Alice Ndom' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & resolve' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This requested target has already been resolved to a different record. Refresh the request before continuing.'
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Prepare requested Device', () => {
  const devices = [
    { name: 'DEV-1', hostname: 'ACI-LT-087', serial_number: 'SN-0087', asset_tag: null, device_type: 'Laptop', status: 'Stock', current_holder: null, current_holder_name: null, selectable: true, unavailable_reason: null },
    { name: 'DEV-2', hostname: 'ACI-LT-023', serial_number: 'SN-0023', asset_tag: null, device_type: 'Laptop', status: 'Active', current_holder: 'CU-7', current_holder_name: 'Franck Mbassi', selectable: true, unavailable_reason: null },
    { name: 'DEV-3', hostname: 'ACI-OLD-002', serial_number: 'SN-OLD2', asset_tag: null, device_type: 'Laptop', status: 'Retired', current_holder: null, current_holder_name: null, selectable: false, unavailable_reason: 'This Device is retired and cannot be selected.' },
  ];

  it('shows the exact copy and every Device of the customer, a held one selectable, a retired one not', async () => {
    vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf(devices));
    vi.mocked(internal.resolveRequestedDevice).mockResolvedValue({ entity: laptop(), plan: planStub });
    const dialog = show(
      <PrepareRequestedDeviceModal entity={laptop()} customer="ACME" onClose={vi.fn()} onSaved={vi.fn()} />
    );

    expect(within(dialog).getByText('Prepare requested Device')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Resolve this requested Device by selecting an existing Device or registering a new one.')
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Requested information' })).toHaveTextContent('New laptop');
    await waitFor(() => expect(internal.listSelectableDevices).toHaveBeenCalled());
    expect(within(dialog).getByRole('tab', { name: 'Register new Device' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing Device' }));
    expect(within(dialog).getByRole('tab', { name: 'Use existing Device' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByPlaceholderText('Hostname, serial, holder…')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Current status and holder are shown for context. Devices are not limited to unassigned stock.'
      )
    ).toBeInTheDocument();

    await within(dialog).findByRole('radio', { name: 'ACI-LT-023' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(3);
    expect(within(dialog).getByText('Stock · No current holder · SN-0087')).toBeInTheDocument();
    expect(within(dialog).getByText('Active · Current holder: Franck Mbassi · SN-0023')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'ACI-OLD-002' })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: 'ACI-LT-023' })).toBeEnabled();
    expect(within(dialog).getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked)).toBe(false);

    fireEvent.click(within(dialog).getByRole('radio', { name: 'ACI-LT-023' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & resolve' }));
    await waitFor(() =>
      expect(internal.resolveRequestedDevice).toHaveBeenCalledWith({
        name: 'RDEV-1',
        mode: 'existing',
        managed_device: 'DEV-2',
      })
    );
  });

  const named = (snapshot: Record<string, unknown>) =>
    laptop({ requested_snapshot: { display_label: 'New laptop', device_type: 'Laptop', ...snapshot } });

  const checked = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('radio')
      .filter((radio) => (radio as HTMLInputElement).checked)
      .map((radio) => radio.getAttribute('aria-label') ?? (radio as HTMLInputElement).value);

  it('pre-selects the Device the requester named by its hostname, and resolves to it', async () => {
    vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf(devices));
    vi.mocked(internal.resolveRequestedDevice).mockResolvedValue({ entity: laptop(), plan: planStub });
    const dialog = show(
      <PrepareRequestedDeviceModal
        entity={named({ hostname: ' aci-lt-023 ', serial_number: null })}
        customer="ACME"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'ACI-LT-023' })).toBeChecked()
    );
    expect(within(dialog).getByRole('tab', { name: 'Use existing Device' })).toHaveAttribute('aria-selected', 'true');
    expect(checked(dialog)).toHaveLength(1);
    expect(
      within(dialog).getByText('Pre-selected from what the requester named. You can choose another Device.')
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & resolve' }));
    await waitFor(() =>
      expect(internal.resolveRequestedDevice).toHaveBeenCalledWith({
        name: 'RDEV-1',
        mode: 'existing',
        managed_device: 'DEV-2',
      })
    );
  });

  it('pre-selects by serial number too, and the technician may still choose another', async () => {
    vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf(devices));
    vi.mocked(internal.resolveRequestedDevice).mockResolvedValue({ entity: laptop(), plan: planStub });
    const dialog = show(
      <PrepareRequestedDeviceModal
        entity={named({ hostname: null, serial_number: 'sn-0087' })}
        customer="ACME"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'ACI-LT-087' })).toBeChecked()
    );

    fireEvent.click(within(dialog).getByRole('radio', { name: 'ACI-LT-023' }));
    expect(within(dialog).getByRole('radio', { name: 'ACI-LT-087' })).not.toBeChecked();
    expect(
      within(dialog).queryByText('Pre-selected from what the requester named. You can choose another Device.')
    ).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & resolve' }));
    await waitFor(() =>
      expect(internal.resolveRequestedDevice).toHaveBeenCalledWith({
        name: 'RDEV-1',
        mode: 'existing',
        managed_device: 'DEV-2',
      })
    );
  });

  it('pre-selects nothing and opens on Register new Device when what was named matches no Device, two Devices, or a retired one', async () => {
    const twins = [...devices, { ...devices[0], name: 'DEV-4', hostname: 'ACI-LT-087', serial_number: 'SN-0099' }];

    for (const [snapshot, rows] of [
      [{ hostname: 'UNKNOWN-HOST', serial_number: null }, devices],
      [{ hostname: 'ACI-LT-087', serial_number: null }, twins],
      [{ hostname: 'ACI-OLD-002', serial_number: null }, devices],
      [{ hostname: null, serial_number: null }, devices],
    ] as const) {
      vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf([...rows]));
      const dialog = show(
        <PrepareRequestedDeviceModal entity={named(snapshot)} customer="ACME" onClose={vi.fn()} onSaved={vi.fn()} />
      );

      await waitFor(() =>
        expect(within(dialog).getByRole('textbox', { name: 'Hostname' })).toBeInTheDocument()
      );
      expect(within(dialog).getByRole('tab', { name: 'Register new Device' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(internal.listSelectableDevices).toHaveBeenCalled());
      fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing Device' }));
      await within(dialog).findByRole('radio', { name: 'ACI-LT-023' });
      expect(checked(dialog)).toHaveLength(0);
      expect(within(dialog).getByRole('button', { name: 'Save & resolve' })).toBeDisabled();
      cleanup();
    }
  });

  it('keeps the tab the technician chose when the list arrives afterwards', async () => {
    let arrive: (value: ReturnType<typeof pageOf<(typeof devices)[number]>>) => void = () => undefined;
    vi.mocked(internal.listSelectableDevices).mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }) as never
    );
    const dialog = show(
      <PrepareRequestedDeviceModal
        entity={named({ hostname: 'ACI-LT-023', serial_number: null })}
        customer="ACME"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(within(dialog).getByRole('tab', { name: 'Register new Device' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Register new Device' }));
    await waitFor(() => expect(internal.listSelectableDevices).toHaveBeenCalled());
    arrive(pageOf(devices));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(dialog).getByRole('tab', { name: 'Register new Device' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Hostname' })).toHaveValue('ACI-LT-023');

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Use existing Device' }));
    expect(within(dialog).getByRole('radio', { name: 'ACI-LT-023' })).toBeChecked();
  });

  it('shows the refusal of a machine whose person does not exist yet as any other refusal', async () => {
    vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf(devices));
    vi.mocked(internal.resolveRequestedDevice).mockRejectedValue(
      new Error('Create Kanto first: this Device is intended for them.')
    );
    const dialog = show(
      <PrepareRequestedDeviceModal
        entity={named({ hostname: 'ACI-LT-120', serial_number: 'SN-0120' })}
        customer="ACME"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await waitFor(() => expect(internal.listSelectableDevices).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Save & resolve' })).toBeEnabled()
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save & resolve' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Create Kanto first: this Device is intended for them.'
    );
  });

  it('registers a new Device once hostname and serial number are known, and saves progress on the way', async () => {
    vi.mocked(internal.listSelectableDevices).mockResolvedValue(pageOf(devices));
    vi.mocked(internal.saveRequestedDevice).mockResolvedValue({ entity: laptop(), plan: planStub });
    vi.mocked(internal.resolveRequestedDevice).mockResolvedValue({ entity: laptop(), plan: planStub });
    const dialog = show(
      <PrepareRequestedDeviceModal entity={laptop()} customer="ACME" onClose={vi.fn()} onSaved={vi.fn()} />
    );

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Register new Device' }));
    for (const field of ['Hostname', 'Serial number', 'Manufacturer', 'Model', 'Operating system']) {
      expect(within(dialog).getByRole('textbox', { name: field })).toBeInTheDocument();
    }
    expect(within(dialog).queryByText('Asset tag')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Device type')).toBeInTheDocument();
    const resolve = within(dialog).getByRole('button', { name: 'Save & resolve' });
    expect(resolve).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Hostname' }), { target: { value: 'ACI-LT-120' } });
    expect(resolve).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }));
    await waitFor(() =>
      expect(internal.saveRequestedDevice).toHaveBeenCalledWith({
        name: 'RDEV-1',
        values: expect.objectContaining({ hostname: 'ACI-LT-120', device_type: 'Laptop', serial_number: null }),
      })
    );
    expect(within(dialog).getByRole('textbox', { name: 'Hostname' })).toHaveValue('ACI-LT-120');

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Serial number' }), { target: { value: 'SN-0120' } });
    expect(resolve).toBeEnabled();
    fireEvent.click(resolve);
    await waitFor(() =>
      expect(internal.resolveRequestedDevice).toHaveBeenCalledWith({
        name: 'RDEV-1',
        mode: 'new',
        values: expect.objectContaining({ hostname: 'ACI-LT-120', serial_number: 'SN-0120' }),
      })
    );
  });
});
