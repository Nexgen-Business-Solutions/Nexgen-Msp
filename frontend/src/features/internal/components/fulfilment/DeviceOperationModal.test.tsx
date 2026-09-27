import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { WorkCard } from '@/lib/api/internal';
import DeviceOperationModal from './DeviceOperationModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, executeDeviceOperation: vi.fn(), listCustomerUsers: vi.fn() };
});

const card = (overrides: Partial<WorkCard> = {}): WorkCard =>
  ({
    name: 'WO-DEV-1',
    plan_key: 'SR-0001:operation:row1',
    work_type: 'Device Operation',
    action: 'Transfer Device',
    operation_code: 'device.transfer',
    action_label: 'Change holder',
    status: 'Open',
    target_scope: 'Device',
    subject_key: 'user:CU-1',
    device_requirement_key: 'device:DEV-1',
    request_line_name: 'row1',
    request_line_idx: 1,
    client_user: null,
    managed_device: 'DEV-1',
    service_item: null,
    service_name: null,
    source_service_assignment: null,
    effective_date: '2026-09-25',
    execution_notes: null,
    customer_visible_note: null,
    failure_reason: null,
    completed_by: null,
    completed_at: null,
    resulting_assignment: null,
    resulting_client_user: null,
    resulting_device: null,
    requested_holder: 'CU-2',
    requested_holder_name: 'Marie Ngono',
    current_holder: 'CU-1',
    current_holder_name: 'Franck Mbassi',
    snapshot_holder: 'CU-1',
    snapshot_holder_name: 'Franck Mbassi',
    holder_changed: false,
    checklist: [],
    ready: true,
    waiting_on: null,
    device: {
      name: 'DEV-1',
      hostname: 'ACI-LT-023',
      serial_number: 'SN-9',
      device_type: 'Laptop',
      status: 'Active',
      assigned_client_user: 'CU-1',
      holder_name: 'Franck Mbassi',
    },
    current: null,
    ...overrides,
  }) as WorkCard;

const show = (work: WorkCard) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeviceOperationModal card={work} customer="ACME" onClose={() => {}} />
    </QueryClientProvider>
  );

beforeEach(() => {
  vi.mocked(internal.listCustomerUsers).mockResolvedValue([
    { name: 'CU-2', full_name: 'Marie Ngono', department: 'Finance' },
    { name: 'CU-3', full_name: 'Paul Etoa', department: 'IT' },
  ] as unknown as Awaited<ReturnType<typeof internal.listCustomerUsers>>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('carrying out a holder change', () => {
  it('runs it for the holder the customer asked for', async () => {
    show(card());

    expect(await screen.findByRole('heading', { name: 'Change holder' })).toBeInTheDocument();
    expect(screen.getByText('Requested holder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change holder' }));

    await waitFor(() =>
      expect(internal.executeDeviceOperation).toHaveBeenCalledWith({
        work_order: 'WO-DEV-1',
        effective_date: '2026-09-25',
        execution_holder: 'CU-2',
        override_reason: undefined,
      })
    );
  });

  it('asks why when it is carried out for somebody else', async () => {
    show(card());

    fireEvent.click(await screen.findByRole('button', { name: /choose who ends up holding it|Marie Ngono/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Paul Etoa/ }));

    expect(
      await screen.findByLabelText('Reason for changing the requested holder')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change holder' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason for changing the requested holder'), {
      target: { value: 'Marie left this morning.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change holder' }));

    await waitFor(() =>
      expect(vi.mocked(internal.executeDeviceOperation).mock.calls[0][0]).toMatchObject({
        execution_holder: 'CU-3',
        override_reason: 'Marie left this morning.',
      })
    );
  });

  it('refuses to run when the machine changed hands since it was asked', async () => {
    show(card({ holder_changed: true, current_holder: 'CU-9', current_holder_name: 'Alice Ndi' }));

    expect(
      await screen.findByText(
        'The Device holder changed after this request was submitted. Review the current holder before continuing.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Requested from')).toBeInTheDocument();
    expect(screen.getByText('Alice Ndi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change holder' })).toBeDisabled();
  });
});

describe('carrying out a return to stock', () => {
  it('names nobody at all', async () => {
    show(
      card({
        operation_code: 'device.repossess',
        action: null,
        action_label: 'Return to stock',
        requested_holder: null,
        requested_holder_name: null,
      })
    );

    expect(await screen.findByRole('heading', { name: 'Return to stock' })).toBeInTheDocument();
    expect(screen.queryByText('Execution holder')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Return to stock' }));

    await waitFor(() =>
      expect(vi.mocked(internal.executeDeviceOperation).mock.calls[0][0]).toMatchObject({
        work_order: 'WO-DEV-1',
        execution_holder: undefined,
      })
    );
  });
});
