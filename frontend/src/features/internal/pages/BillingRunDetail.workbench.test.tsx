import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { BillingRunDetail as RunDetail, BillingRunLine } from '@/lib/api/internal';
import BillingRunDetail from './BillingRunDetail';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getBillingRun: vi.fn(),
    removeFromBillingRun: vi.fn(),
    runBillingAction: vi.fn(),
    setBillingLineDiscount: vi.fn(),
    getInvoiceDimensions: vi.fn(),
  };
});

const line = (overrides: Partial<BillingRunLine> = {}): BillingRunLine =>
  ({
    idx: 1,
    line: 'row1',
    service_assignment: 'SA-1',
    service_item: 'M365',
    service_name: 'Microsoft 365',
    assignment_scope: 'User',
    client_user: 'CU-1',
    managed_device: null,
    user_name: 'John Doe',
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
    email: 'john@acme.com',
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
    ...overrides,
  }) as BillingRunLine;

const detail = (overrides: Partial<RunDetail> = {}): RunDetail =>
  ({
    name: 'BR-2026-08-001',
    customer: 'ACME',
    contract: 'CT-1',
    contract_title: 'ACME Managed Services',
    period_label: 'August 2026',
    status: 'Ready for Approval',
    docstatus: 0,
    billing_period_start: '2026-08-01',
    billing_period_end: '2026-08-31',
    cutoff_datetime: '2026-09-01 00:00:00',
    currency: 'USD',
    total_amount: 20,
    exception_count: 0,
    prepared_by: 'Peter',
    approved_by: null,
    approved_at: null,
    sales_order: null,
    sales_invoice: null,
    invoice_status: null,
    invoice_submitted: false,
    adjustment_of: null,
    credit_note_of: null,
    credit_note_reason: null,
    disputed: false,
    dispute_reason: null,
    disputed_on: null,
    is_credit_note: false,
    lines: [line()],
    can_approve: true,
    discount_percent: 0,
    can_discount_lines: true,
    can_revalidate: true,
    can_invoice: false,
    ...overrides,
  }) as unknown as RunDetail;

const renderPage = async (data: RunDetail) => {
  vi.mocked(internal.getBillingRun).mockResolvedValue(data);
  vi.mocked(internal.getInvoiceDimensions).mockResolvedValue([]);
  vi.mocked(internal.removeFromBillingRun).mockResolvedValue(data);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/billing/BR-2026-08-001']}>
        <Routes>
          <Route path="/msp/billing/:name" element={<BillingRunDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('BR-2026-08-001');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('drawing a run and finishing it is one job', () => {
  it('shows the six phases of the work', async () => {
    await renderPage(detail());

    for (const stage of ['Scope', 'Selection', 'Validation', 'Review', 'Invoice', 'Complete']) {
      expect(screen.getByRole('button', { name: stage })).toBeInTheDocument();
    }
  });

  it('stands on review when the lines are clean', async () => {
    await renderPage(detail());

    expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute(
      'aria-current',
      'step'
    );
  });

  it('stands on validation, flagged, when something is blocked', async () => {
    await renderPage(
      detail({
        status: 'Exception',
        exception_count: 1,
        lines: [line({ exception_code: 'Missing Rate', exception_detail: 'No rate.', amount: 0 })],
      })
    );

    expect(screen.getByRole('button', { name: 'Validation' })).toHaveAttribute(
      'aria-current',
      'step'
    );
  });
});

describe('what is blocked is explained where it can be acted on', () => {
  const blocked = detail({
    status: 'Exception',
    exception_count: 1,
    lines: [
      line(),
      line({
        line: 'row2',
        service_assignment: 'SA-2',
        service_name: 'Sophos Endpoint',
        exception_code: 'Missing Rate',
        exception_detail: 'No rate covers this period.',
        amount: 0,
      }),
    ],
  });

  it('groups the blockers by what is wrong, with the context in front of them', async () => {
    await renderPage(blocked);

    const panel = screen.getByText(/cannot be billed/i).closest('section') as HTMLElement;

    expect(within(panel).getByText(/missing rate/i)).toBeInTheDocument();
    expect(within(panel).getByText('Sophos Endpoint')).toBeInTheDocument();
    expect(within(panel).getByText(/John Doe/)).toBeInTheDocument();
  });

  it('says how each kind of blocker is answered', async () => {
    await renderPage(blocked);

    expect(screen.getByText(/set a rate for this service/i)).toBeInTheDocument();
  });

  it('takes a blocker off the run without touching the service', async () => {
    await renderPage(blocked);

    const panel = screen.getByText(/cannot be billed/i).closest('section') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: /remove from this run/i }));

    await waitFor(() => expect(internal.removeFromBillingRun).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.removeFromBillingRun).mock.calls[0][0]).toMatchObject({
      name: 'BR-2026-08-001',
      service_assignment: 'SA-2',
    });
  });

  it('says nothing at all when nothing is blocked', async () => {
    await renderPage(detail());

    expect(screen.queryByText(/cannot be billed/i)).not.toBeInTheDocument();
  });
});

describe('the run reads as it was written', () => {
  it('shows the stretches a paused service was really live over', async () => {
    await renderPage(
      detail({
        lines: [
          line({
            segments: [
              { from: '2026-08-01', to: '2026-08-09' },
              { from: '2026-08-16', to: '2026-08-31' },
            ],
          }),
        ],
      })
    );

    expect(screen.getByText(/paused in between/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-09/)).toBeInTheDocument();
  });

  it('shows the machine and who was carrying it, as context', async () => {
    await renderPage(
      detail({
        lines: [
          line({
            assignment_scope: 'Device',
            client_user: null,
            user_name: null,
            hostname: 'LAPTOP-JDOE',
            serial_number: 'ABC123',
            holder_context: 'Alice: 2026-08-01 → 2026-08-31',
          }),
        ],
      })
    );

    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText(/held by Alice/)).toBeInTheDocument();
  });

  it('sends nobody to another page to read a line', async () => {
    await renderPage(detail());

    expect(screen.queryByRole('button', { name: /view profile/i })).not.toBeInTheDocument();
  });
});
