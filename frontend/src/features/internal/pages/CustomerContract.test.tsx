import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  ContractDetail,
  ServiceAvailability,
  ServiceAvailabilityCurrent,
} from '@/lib/api/internal';
import CustomerContract from './CustomerContract';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getContract: vi.fn(),
    listContractRates: vi.fn(),
    getCustomerDetails: vi.fn(),
    listMspContracts: vi.fn(),
    customerServiceAvailability: vi.fn(),
  };
});

const DATED_REASON = 'A change to this service is already set for a day to come.';

const contract = {
  customer: 'ACME',
  profile: null,
  price_list: null,
  currency: null,
  services: [],
  readiness: { ready: true, blockers: [] },
} as unknown as ContractDetail;

const heldService = (
  overrides: Partial<ServiceAvailabilityCurrent> = {}
): ServiceAvailabilityCurrent => ({
  name: 'SA-0001',
  service_item: 'RETAINER',
  item_name: 'Monthly retainer',
  service_scope: 'Customer',
  operational_status: 'Active',
  billing_status: 'Billable',
  quantity: 1,
  uom: 'Month',
  effective_start_date: '2026-01-01',
  effective_end_date: null,
  dated_change: false,
  agreed_rate: 500,
  price_source: 'Contract',
  ...overrides,
});

const readingOf = (row: ServiceAvailabilityCurrent): ServiceAvailability => ({
  target: { name: 'ACME', label: 'ACME' },
  is_admin: true,
  target_reason: null,
  current: [row],
  available: [],
  blocked: [],
} as unknown as ServiceAvailability);

const show = async (row: ServiceAvailabilityCurrent) => {
  vi.mocked(internal.customerServiceAvailability).mockResolvedValue(readingOf(row));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/msp/customers/ACME']}>
        <Routes>
          <Route path="/msp/customers/:customer" element={<CustomerContract />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  await screen.findByText(row.item_name);
};

const rowTrigger = (row: ServiceAvailabilityCurrent) =>
  within(screen.getByText(row.item_name).closest('tr') as HTMLElement).getByRole('button', {
    name: /more options/i,
  });

const openMenu = async (row: ServiceAvailabilityCurrent) => {
  await show(row);
  fireEvent.click(rowTrigger(row));
  return screen.getByRole('menu');
};

const offered = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);

beforeEach(() => {
  vi.mocked(internal.getContract).mockResolvedValue(contract);
  vi.mocked(internal.listContractRates).mockResolvedValue([]);
  vi.mocked(internal.getCustomerDetails).mockResolvedValue({
    customer_name: 'Acme Corp',
    disabled: 0,
    can: { manage_pricing: true },
    counts: { users: 0, devices: 0 },
  } as unknown as Awaited<ReturnType<typeof internal.getCustomerDetails>>);
  vi.mocked(internal.listMspContracts).mockResolvedValue([]);
});

afterEach(cleanup);

describe('acting on a service the company holds', () => {
  it('offers no act on an active service whose end is already dated, and says why', async () => {
    const row = heldService({
      operational_status: 'Active',
      dated_change: true,
      effective_end_date: '2099-12-31',
    });
    await show(row);

    const trigger = rowTrigger(row);
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAccessibleDescription(DATED_REASON);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    for (const label of ['Change quantity or rate', 'Suspend', 'Resume', 'End service']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('offers to change, suspend and end the same active service once nothing is dated', async () => {
    const menu = await openMenu(heldService({ operational_status: 'Active', dated_change: false }));

    expect(offered(menu)).toEqual(['Change quantity or rate', 'Suspend', 'End service']);
    expect(within(menu).queryByRole('menuitem', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('does not offer to resume a suspended service that already carries a dated change', async () => {
    const row = heldService({ operational_status: 'Suspended', dated_change: true });
    await show(row);

    const trigger = rowTrigger(row);
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAccessibleDescription(DATED_REASON);
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it('offers to resume and end a suspended service when nothing is dated', async () => {
    const menu = await openMenu(heldService({ operational_status: 'Suspended', dated_change: false }));

    expect(offered(menu)).toEqual(['Resume', 'End service']);
  });

  it('still offers to cancel a pending service, because cancelling is not a dated change', async () => {
    const menu = await openMenu(heldService({ operational_status: 'Pending Setup', dated_change: false }));

    expect(offered(menu)).toEqual(['Cancel pending service']);
  });

  it('still offers to cancel a pending service carrying a dated change', async () => {
    const menu = await openMenu(
      heldService({ operational_status: 'Pending Setup', dated_change: true }),
    );

    expect(offered(menu)).toEqual(['Cancel pending service']);
  });
});
