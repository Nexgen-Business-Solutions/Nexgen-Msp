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
  agreed_rate: 42,
  price_source: 'Manual Override',
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
  changing: ServiceAvailabilityCurrent | null = null,
  mayPrice = true
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
        mayPrice={mayPrice}
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
    // the quantity and the rate it already holds are not a change
    expect(screen.getByRole('button', { name: /^save change$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /^save change$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.changeCustomerService).mock.calls[0][0]).toMatchObject({
        assignment: 'SA-0001',
        action: 'Change',
        quantity: 8,
      })
    );
    expect(internal.assignCustomerService).not.toHaveBeenCalled();
  });

  /**
   * The rate was the one term of a company service the screen could not say anything about,
   * so a price agreed on the telephone had to be written in the Desk.
   */
  it('changes the rate on file, with the reason it was agreed at', async () => {
    open(reading({ current: [storage] }), storage);

    // the rate it is sold at now is what the form opens on
    expect(await screen.findByLabelText('Agreed rate')).toHaveValue(42);

    fireEvent.change(screen.getByLabelText('Agreed rate'), { target: { value: '36' } });
    fireEvent.change(await screen.findByLabelText('Why this rate'), {
      target: { value: 'Renegotiated for the 2027 renewal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save change$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.changeCustomerService).mock.calls[0][0]).toMatchObject({
        assignment: 'SA-0001',
        action: 'Change',
        quantity: 5,
        agreed_rate: 36,
        rate_override_reason: 'Renegotiated for the 2027 renewal',
      })
    );
  });

  it('will not change a rate without saying why', async () => {
    open(reading({ current: [storage] }), storage);

    fireEvent.change(await screen.findByLabelText('Agreed rate'), { target: { value: '36' } });

    expect(screen.getByRole('button', { name: /^save change$/i })).toBeDisabled();
    expect(internal.changeCustomerService).not.toHaveBeenCalled();
  });

  it('leaves the rate alone when only the quantity moves', async () => {
    open(reading({ current: [storage] }), storage);

    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /^save change$/i }));

    await waitFor(() => expect(internal.changeCustomerService).toHaveBeenCalled());

    const sent = vi.mocked(internal.changeCustomerService).mock.calls[0][0];

    // nothing about the rate is sent, so the service keeps the 42 it was agreed at
    expect(sent).not.toHaveProperty('agreed_rate');
    expect(sent).not.toHaveProperty('rate_override_reason');
    expect(screen.queryByLabelText('Why this rate')).not.toBeInTheDocument();
  });

  /**
   * A price put on the record by hand is what Billing takes literally. Opening a service
   * is operational; pricing it is not, and the server refuses it too.
   */
  it('offers no rate at all to an account that may not price', async () => {
    open(reading({ current: [storage] }), storage, false);

    expect(await screen.findByLabelText('Quantity')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agreed rate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Why this rate')).not.toBeInTheDocument();
  });

  it('sends no rate when that account changes the quantity', async () => {
    open(reading({ current: [storage] }), storage, false);

    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /^save change$/i }));

    await waitFor(() => expect(internal.changeCustomerService).toHaveBeenCalled());

    const sent = vi.mocked(internal.changeCustomerService).mock.calls[0][0];

    expect(sent).not.toHaveProperty('agreed_rate');
    // and the rate it was agreed at is untouched, because the engine holds it over
    expect(sent).toMatchObject({ quantity: 8 });
  });

  it('asks for a reason when a new service is given a rate by hand', async () => {
    open();

    fireEvent.click(await screen.findByRole('button', { name: /select a service/i }));
    fireEvent.click(await screen.findByRole('option', { name: /cloud storage/i }));
    fireEvent.change(screen.getByLabelText('Agreed rate'), { target: { value: '42' } });

    expect(screen.getByRole('button', { name: /^add service$/i })).toBeDisabled();

    fireEvent.change(await screen.findByLabelText('Why this rate'), {
      target: { value: 'Agreed at signature' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add service$/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.assignCustomerService).mock.calls[0][0]).toMatchObject({
        agreed_rate: 42,
        rate_override_reason: 'Agreed at signature',
      })
    );
  });
});
