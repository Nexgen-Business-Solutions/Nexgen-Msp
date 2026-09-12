import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { RequestDetail } from '@/lib/api/internal';
import DeliveryDetailsModal from './DeliveryDetailsModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, setRequestDeliveryDetail: vi.fn() };
});

const line = (overrides: Partial<RequestDetail['lines'][number]>) =>
  ({
    idx: 1,
    action: 'Add',
    line_status: 'Pending',
    requested_service: 'M365',
    requested_service_name: 'Microsoft 365',
    device_hostname: 'LAPTOP-JDOE',
    client_user_name: 'John Doe',
    needs_serial: false,
    needs_username: false,
    new_device_serial: null,
    new_user_username: null,
    ...overrides,
  }) as unknown as RequestDetail['lines'][number];

const renderModal = (lines: RequestDetail['lines']) => {
  vi.mocked(internal.setRequestDeliveryDetail).mockResolvedValue(
    {} as unknown as Awaited<ReturnType<typeof internal.setRequestDeliveryDetail>>
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <DeliveryDetailsModal
        request={{ name: 'SR-0001', lines } as unknown as RequestDetail}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    </QueryClientProvider>
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('what the customer already knew reaches the technician', () => {
  it('starts empty when the customer supplied nothing', () => {
    renderModal([line({ needs_serial: true })]);

    expect(screen.getByPlaceholderText(/read it off the machine/i)).toHaveValue('');
    expect(screen.queryByText(/supplied by the customer/i)).not.toBeInTheDocument();
  });

  it('offers the serial the customer gave, marked as theirs to confirm', () => {
    renderModal([line({ needs_serial: true, new_device_serial: 'SN-9912' })]);

    expect(screen.getByPlaceholderText(/read it off the machine/i)).toHaveValue('SN-9912');
    expect(screen.getByText(/supplied by the customer/i)).toBeInTheDocument();
  });

  it('offers the account name the customer gave', () => {
    renderModal([line({ needs_username: true, new_user_username: 'm.dupont' })]);

    expect(screen.getByPlaceholderText(/account name on the licence/i)).toHaveValue('m.dupont');
  });

  it('saves what is there without the technician retyping it', async () => {
    renderModal([line({ needs_serial: true, new_device_serial: 'SN-9912' })]);

    fireEvent.click(screen.getByRole('button', { name: /save and close/i }));

    await waitFor(() => expect(internal.setRequestDeliveryDetail).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.setRequestDeliveryDetail).mock.calls[0][0]).toMatchObject({
      name: 'SR-0001',
      idx: 1,
      serial_number: 'SN-9912',
    });
  });

  it('lets the technician correct it', async () => {
    renderModal([line({ needs_serial: true, new_device_serial: 'SN-WRONG' })]);

    fireEvent.change(screen.getByPlaceholderText(/read it off the machine/i), {
      target: { value: 'SN-REAL' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save and close/i }));

    await waitFor(() => expect(internal.setRequestDeliveryDetail).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.setRequestDeliveryDetail).mock.calls[0][0]).toMatchObject({
      serial_number: 'SN-REAL',
    });
  });
});
