import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { BillingPreview, BillingRunLine, MspContract } from '@/lib/api/internal';
import NewBillingRun from './NewBillingRun';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    listMspContracts: vi.fn(),
    previewBillingRun: vi.fn(),
    getBillingFilterOptions: vi.fn(),
    getBillingPeriodStatus: vi.fn(),
    generateBillingRun: vi.fn(),
  };
});

const CONTRACT: MspContract = {
  name: 'CT-1',
  customer: 'ACME',
  title: 'ACME managed services',
  status: 'Active',
  start_date: '2020-01-01',
  end_date: null,
  billing_frequency: 'Monthly',
  billing_timing: 'In Arrears',
  proration_method: 'Daily Actual Days',
  invoice_grouping: 'One Invoice',
  price_list: 'Standard Selling',
  price_list_valid_upto: null,
  currency: 'XAF',
  default_cost_center: null,
  billing_notes: null,
  services: [],
};

const line = (index: number): BillingRunLine =>
  ({
    idx: index + 1,
    line: `row${index}`,
    service_assignment: `SA-${index}`,
    service_item: 'M365',
    service_name: 'Microsoft 365',
    assignment_scope: 'User',
    client_user: `CU-${index}`,
    managed_device: null,
    user_name: `Person ${index}`,
    hostname: null,
    serial_number: null,
    holder_context: null,
    department: 'Accounting',
    user_status: 'Active',
    device_type: null,
    billed_to: 'User',
    operational_status: 'Active',
    effective_start_date: '2026-01-10',
    last_billed_on: null,
    email: `person${index}@acme.example`,
    quantity: 1,
    billable_days: 31,
    period_days: 31,
    billable_months: 1,
    covered_from: '2026-08-01',
    covered_to: '2026-08-31',
    gross_amount: 20,
    discount_percent: 0,
    discount_source: null,
    unit_rate: 20,
    price_source: 'Contract',
    proration_method: 'Daily Actual Days',
    amount: 20,
    exception_code: null,
    exception_detail: null,
    line_comment: null,
    segments: [{ from: '2026-08-01', to: '2026-08-31' }],
  }) as unknown as BillingRunLine;

const preview = (count: number): BillingPreview =>
  ({
    contract: 'CT-1',
    contract_title: 'ACME managed services',
    customer: 'ACME',
    matched: count,
    available: count,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    currency: 'XAF',
    proration_method: 'Daily Actual Days',
    billing_frequency: 'Monthly',
    lines: Array.from({ length: count }, (_, index) => line(index)),
    line_count: count,
    billable_count: count,
    exception_count: 0,
    exceptions_by_code: {},
    blocked_count: 0,
    blocked_by_code: {},
    total_amount: count * 20,
    total_months: count,
  }) as unknown as BillingPreview;

const openSelection = async (count: number) => {
  vi.mocked(internal.listMspContracts).mockResolvedValue([CONTRACT]);
  vi.mocked(internal.previewBillingRun).mockResolvedValue(preview(count));
  vi.mocked(internal.getBillingFilterOptions).mockResolvedValue({
    statuses: ['Active'],
    billed_to: ['User'],
    user_statuses: ['Active'],
    services: [{ value: 'M365', label: 'Microsoft 365' }],
    device_types: [],
    departments: ['Accounting'],
  });
  vi.mocked(internal.getBillingPeriodStatus).mockResolvedValue({
    customer: 'ACME',
    eligible: count,
    already_billed: 0,
    remaining: count,
    fully_billed: false,
    runs: [],
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/msp/billing/new?contract=CT-1&start=2026-08-01&end=2026-08-31']}
      >
        <NewBillingRun />
      </MemoryRouter>
    </QueryClientProvider>
  );

  fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

  await waitFor(() => expect(internal.previewBillingRun).toHaveBeenCalled());
  await screen.findByText('Person 0');
};

// the filter panel has a tickbox of its own, so a candidate is one that sits in a row
const rowBoxes = () => screen.getAllByRole('checkbox').filter((box) => box.closest('td'));

// the counters read "650 selected · 650.0 months", split across elements
const summary = () => document.body.textContent ?? '';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a run with more candidates than a page can hold', () => {
  it('draws a window of them rather than every one', async () => {
    await openSelection(650);

    expect(screen.getByText('Person 199')).toBeInTheDocument();
    expect(screen.queryByText('Person 200')).not.toBeInTheDocument();
    expect(screen.getByText(/showing 200 of 650/i)).toBeInTheDocument();
  });

  it('reaches further when asked', async () => {
    await openSelection(650);

    fireEvent.click(screen.getByRole('button', { name: /show more/i }));

    expect(await screen.findByText('Person 200')).toBeInTheDocument();
    expect(screen.getByText(/showing 400 of 650/i)).toBeInTheDocument();
  });

  it('bills the ones nobody has scrolled to', async () => {
    await openSelection(650);

    expect(rowBoxes()).toHaveLength(200);
    expect(summary()).toMatch(/650\s*selected/);
  });

  it('draws no window at all when everything fits', async () => {
    await openSelection(12);

    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
    expect(rowBoxes()).toHaveLength(12);
  });
});

describe('what was unticked survives the window', () => {
  it('keeps a tick made on screen after the window grows', async () => {
    await openSelection(650);

    fireEvent.click(rowBoxes()[0]);
    expect(summary()).toMatch(/649\s*selected/);

    fireEvent.click(screen.getByRole('button', { name: /show more/i }));
    await screen.findByText('Person 200');

    expect(rowBoxes()[0]).not.toBeChecked();
    expect(summary()).toMatch(/649\s*selected/);
  });

  it('clears every candidate, not only the drawn ones', async () => {
    await openSelection(650);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(summary()).toMatch(/650\s*excluded by hand/);
    expect(rowBoxes().some((box) => (box as HTMLInputElement).checked)).toBe(false);
  });
});
