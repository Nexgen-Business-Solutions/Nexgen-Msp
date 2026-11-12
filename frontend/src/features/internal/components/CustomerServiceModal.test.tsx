import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { ServiceAvailability, ServiceAvailabilityCurrent } from '@/lib/api/internal';
import CustomerServiceModal from './CustomerServiceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    customerServiceAvailability: vi.fn(),
    assignCustomerService: vi.fn(),
    changeCustomerService: vi.fn(),
  };
});

const storage: ServiceAvailabilityCurrent = {
  name: 'SA-0001',
  service_item: 'ITEM-STORAGE',
  item_name: 'Cloud Storage',
  service_scope: 'Customer',
  operational_status: 'Active',
  billing_status: 'Billable',
  quantity: 5,
  uom: 'TB',
  effective_start_date: '2026-01-01',
};

const reading = (overrides: Partial<ServiceAvailability> = {}): ServiceAvailability => ({
  target: { scope: 'Customer', name: 'CUST-001', label: 'Nexgen SA', customer: 'CUST-001' },
  is_admin: true,
  target_reason: null,
  current: [],
  available: [
    { service_item: 'ITEM-STORAGE', item_name: 'Cloud Storage', service_scope: 'Customer' },
  ],
  blocked: [],
  ...overrides,
});

const open = (
  data: ServiceAvailability = reading(),
  changing: ServiceAvailabilityCurrent | null = null
) => {
  vi.mocked(internal.assignCustomerService).mockResolvedValue(data);
  vi.mocked(internal.changeCustomerService).mockResolvedValue(data);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <CustomerServiceModal
        customer="CUST-001"
        label="Nexgen SA"
        reading={data}
        changing={changing}
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CustomerServiceModal', () => {
  it('sends the service and the quantity the company holds, and names no person', async () => {
    open();

    fireEvent.click(await screen.findByRole('button', { name: /select a service/i }));
    fireEvent.click(await screen.findByRole('option', { name: /cloud storage/i }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^add service$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.assignCustomerService).mock.calls[0][0]).toMatchObject({
        customer: 'CUST-001',
        service_item: 'ITEM-STORAGE',
        quantity: 5,
      })
    );

    const sent = vi.mocked(internal.assignCustomerService).mock.calls[0][0];

    expect(sent).not.toHaveProperty('client_user');
    expect(sent).not.toHaveProperty('managed_device');
  });

  it('refuses a quantity of nothing', async () => {
    open();

    fireEvent.click(await screen.findByRole('button', { name: /select a service/i }));
    fireEvent.click(await screen.findByRole('option', { name: /cloud storage/i }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } });

    expect(screen.getByRole('button', { name: /^add service$/i })).toBeDisabled();
    expect(internal.assignCustomerService).not.toHaveBeenCalled();
  });

  it('offers nothing and says why when the company itself cannot be sold one', async () => {
    open(reading({ target_reason: 'Nexgen SA is disabled and cannot be sold a new service.' }));

    expect(
      await screen.findByText('Nexgen SA is disabled and cannot be sold a new service.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /no company service left to add/i })
    ).toBeInTheDocument();
  });

  it('changes a running period rather than opening a second one', async () => {
    open(reading({ current: [storage] }), storage);

    expect(await screen.findByText('Cloud Storage')).toBeInTheDocument();
    expect(screen.getByText(/Counted in TB/)).toBeInTheDocument();
    // the quantity it already holds is not a change
    expect(screen.getByRole('button', { name: /^change quantity$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /^change quantity$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.changeCustomerService).mock.calls[0][0]).toMatchObject({
        assignment: 'SA-0001',
        action: 'Change',
        quantity: 8,
      })
    );
    expect(internal.assignCustomerService).not.toHaveBeenCalled();
  });
});
