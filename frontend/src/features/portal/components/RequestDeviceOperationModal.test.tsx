import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import RequestDeviceOperationModal from './RequestDeviceOperationModal';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return { ...actual, searchRequestUsers: vi.fn() };
});

vi.mock('../store/usePortalFilters', () => ({
  usePortalFilters: (select: (state: { customer: string | null }) => unknown) =>
    select({ customer: 'ACME' }),
}));

const device = { name: 'DEV-1', hostname: 'ACI-LT-023', serial_number: 'SN-9' };

const marie = {
  name: 'CU-2',
  full_name: 'Marie Ngono',
  email: 'marie@acme.com',
  department: 'Finance',
  lifecycle_status: 'Active',
};

const show = (
  code: 'device.assign' | 'device.transfer' | 'device.repossess',
  label: string,
  onContinue = vi.fn()
) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RequestDeviceOperationModal
        code={code}
        label={label}
        device={device}
        currentHolder={code === 'device.assign' ? null : 'CU-1'}
        currentHolderName={code === 'device.assign' ? null : 'Franck Mbassi'}
        onClose={() => {}}
        onContinue={onContinue}
      />
    </QueryClientProvider>
  );

  return onContinue;
};

beforeEach(() => {
  vi.mocked(portal.searchRequestUsers).mockResolvedValue([marie]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('asking for a holder change', () => {
  it('says the holder does not move until Nexgen performs it', async () => {
    show('device.transfer', 'Change holder');

    expect(await screen.findByText('Request holder change')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The current holder stays unchanged until Nexgen approves and performs the transfer.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('ACI-LT-023')).toBeInTheDocument();
    expect(screen.getByText('Franck Mbassi')).toBeInTheDocument();
  });

  it('cannot continue before a new holder is named', async () => {
    show('device.transfer', 'Change holder');

    const submit = await screen.findByRole('button', { name: 'Continue to request' });
    expect(submit).toBeDisabled();
  });

  it('hands the operation to the request builder, with nothing written to the machine', async () => {
    const onContinue = show('device.transfer', 'Change holder');

    fireEvent.change(screen.getByLabelText('New holder'), { target: { value: 'Marie' } });
    fireEvent.click(await screen.findByRole('button', { name: /Marie Ngono/ }));
    fireEvent.change(screen.getByLabelText('Requested date'), { target: { value: '2026-09-25' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'She takes over.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to request' }));

    expect(onContinue).toHaveBeenCalledWith({
      operationCode: 'device.transfer',
      actionLabel: 'Change holder',
      managedDevice: 'DEV-1',
      deviceLabel: 'ACI-LT-023',
      subject: { clientUser: 'CU-2', fullName: 'Marie Ngono', department: 'Finance' },
      requestedHolder: 'CU-2',
      requestedHolderLabel: 'Marie Ngono',
      currentHolder: 'CU-1',
      currentHolderLabel: 'Franck Mbassi',
      requestedEffectiveDate: '2026-09-25',
      comment: 'She takes over.',
    });
  });
});

describe('the other two acts a customer may ask for', () => {
  it('an assignment says the machine stays unassigned until then', async () => {
    show('device.assign', 'Assign device');

    expect(await screen.findByText('Request device assignment')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The Device remains unassigned until Nexgen approves and performs the assignment.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('a return to stock asks for nobody and is about the current holder', async () => {
    const onContinue = show('device.repossess', 'Return to stock');

    expect(await screen.findByText('Request return to stock')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The current holder keeps the Device until Nexgen approves and performs the return.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('New holder')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to request' }));

    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        operationCode: 'device.repossess',
        subject: { clientUser: 'CU-1', fullName: 'Franck Mbassi' },
        requestedHolder: undefined,
      })
    );
  });
});
