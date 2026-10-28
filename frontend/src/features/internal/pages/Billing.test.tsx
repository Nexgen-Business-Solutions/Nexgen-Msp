import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { BillingWorkspace } from '@/lib/api/internal';
import Billing from './Billing';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();

  return { ...actual, getBillingWorkspace: vi.fn(), listMspContracts: vi.fn() };
});

const workspace = (overrides: Partial<BillingWorkspace> = {}): BillingWorkspace => ({
  as_of: '2026-10-20',
  figures: {
    runs: 8,
    settled: 6,
    awaiting: 1,
    blocked: 2,
    blocked_lines: 105,
    invoiced_totals: [
      { currency: 'XAF', amount: 1879497 },
      { currency: 'USD', amount: 14340 },
    ],
  },
  actions: [
    {
      kind: 'credit_note',
      contract: 'CON-0001',
      customer: 'Kakivu Mousse USD',
      title: null,
      currency: 'XAF',
      frequency: 'Quarterly',
      timing: 'In Advance',
      period_start: '2026-07-01',
      period_end: '2026-09-30',
      run_start: '2026-07-01',
      run_end: '2026-09-30',
      lines: 8,
      amount: -11163.6,
      run: 'BR-2026-07-001',
      state: null,
      open_run: null,
    },
    {
      kind: 'period',
      contract: 'CON-0001',
      customer: 'Kakivu Mousse USD',
      title: null,
      currency: 'XAF',
      frequency: 'Quarterly',
      timing: 'In Advance',
      period_start: '2026-10-01',
      period_end: '2026-12-31',
      run_start: '2026-10-01',
      run_end: '2026-12-31',
      lines: 2,
      amount: null,
      run: null,
      state: 'Overdue',
      days_left: -19,
      open_run: null,
    },
  ],
  tab: 'runs',
  rows: [
    {
      name: 'BR-2026-10-1085',
      customer: 'Assurances Cameroun International',
      kind: 'Regular billing',
      period_start: '2026-09-04',
      period_end: '2027-02-24',
      lines: 1,
      exceptions: 0,
      amount: 11997,
      currency: 'XAF',
      sales_invoice: 'ACC-SINV-2026-00048',
      status: 'Invoiced',
      disputed: false,
    },
  ],
  total: 8,
  page: 1,
  page_length: 20,
  counts: { runs: 8, invoices: 6 },
  ...overrides,
});

const draw = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/billing']}>
        <Billing />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the billing page reads one workspace', () => {
  it('shows the four figures without adding two currencies together', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(workspace());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    expect((await screen.findAllByText('Billing runs')).length).toBeGreaterThan(0);
    expect(screen.getByText('1,879,497 XAF')).toBeInTheDocument();
    expect(screen.getByText('+ 14,340 USD')).toBeInTheDocument();
    expect(screen.getByText('105 lines to resolve')).toBeInTheDocument();
  });

  it('lists one line per operation waiting, each typed and never merged', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(workspace());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    expect(await screen.findByText('Credit note')).toBeInTheDocument();
    expect(screen.getAllByText('Regular billing').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Review credit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepare run/ })).toBeInTheDocument();
  });

  it('says how overdue a period is, and what a credit is owed on', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(workspace());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    expect(await screen.findByText('Overdue · 19d')).toBeInTheDocument();
    expect(screen.getByText('Owed back')).toBeInTheDocument();
  });

  it('counts both tabs and opens the invoices on their own', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(workspace());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    const tab = await screen.findByRole('button', { name: /^Sales invoices/ });

    expect(within(tab).getByText('6')).toBeInTheDocument();

    fireEvent.click(tab);

    await waitFor(() =>
      expect(vi.mocked(internal.getBillingWorkspace).mock.calls.at(-1)?.[0]).toMatchObject({
        tab: 'invoices',
      })
    );
  });

  it('narrows the list to what a figure counted when its eye is used', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(workspace());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /runs to resolve/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.getBillingWorkspace).mock.calls.at(-1)?.[0]).toMatchObject({
        status: 'issue',
      })
    );
  });

  it('never says a run is posted when the status does not', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(
      workspace({
        rows: [
          {
            name: 'BR-2026-10-9',
            customer: 'ACME',
            kind: 'Regular billing',
            period_start: '2026-09-01',
            period_end: '2026-09-30',
            lines: 3,
            exceptions: 0,
            amount: 100,
            currency: 'XAF',
            sales_invoice: 'ACC-SINV-2026-00099',
            status: 'Invoice Drafted',
            disputed: false,
          },
        ],
      })
    );
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    expect(await screen.findByText('Invoice Drafted')).toBeInTheDocument();
    expect(screen.queryByText('Invoiced', { exact: true })).not.toBeInTheDocument();
  });
});

/**
 * A credit is money going back.
 *
 * The server settles which way each figure points, so the list prints what it is given: a
 * credit note reads as a deduction and keeps saying it is a credit note, whatever state its
 * document is in — and nothing on the way adds a second minus sign.
 */
describe('how the history reads a credit note', () => {
  const creditRun = {
    name: 'BR-2026-10-004',
    customer: 'Kakivu Mousse USD',
    kind: 'Credit note',
    period_start: '2026-07-01',
    period_end: '2026-09-30',
    lines: 4,
    exceptions: 0,
    amount: -23.48,
    currency: 'USD',
    sales_invoice: 'R-SINV-2026-00021',
    is_credit_note: true,
    invoice_docstatus: 1,
    needs_reconciliation: false,
    status: 'Invoiced',
    disputed: false,
  };

  it('shows a posted credit note as a deduction, still typed as a credit note', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(workspace({ rows: [creditRun] }));
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    const row = (await screen.findByText('BR-2026-10-004')).closest('tr') as HTMLElement;

    expect(within(row).getByText('−23.48 USD')).toBeInTheDocument();
    expect(within(row).getByText('Credit note')).toBeInTheDocument();
    expect(within(row).getByText('Invoiced'), 'what it is and what state it is in').toBeInTheDocument();
    expect(within(row).queryByText('23.48 USD')).not.toBeInTheDocument();
  });

  it('keeps a regular run positive beside it', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(
      workspace({
        rows: [
          creditRun,
          { ...creditRun, name: 'BR-2026-10-003', kind: 'Regular billing', amount: 100, is_credit_note: false },
        ],
      })
    );
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    const charge = (await screen.findByText('BR-2026-10-003')).closest('tr') as HTMLElement;

    expect(within(charge).getByText('100.00 USD')).toBeInTheDocument();
    expect(within(charge).queryByText('−100.00 USD')).not.toBeInTheDocument();
  });

  it('shows a return in the invoices list with one minus sign, not two', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(
      workspace({
        tab: 'invoices',
        rows: [
          {
            name: 'R-SINV-2026-00021',
            customer: 'Kakivu Mousse USD',
            posting_date: '2026-10-20',
            due_date: '2026-11-19',
            amount: -23.48,
            outstanding: -23.48,
            currency: 'USD',
            is_return: true,
            origin: 'MSP',
            billing_run: 'BR-2026-10-004',
            status: 'Return',
          },
        ],
      })
    );
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /^Sales invoices/ }));

    const row = (await screen.findByText('R-SINV-2026-00021')).closest('tr') as HTMLElement;

    expect(within(row).getAllByText('−23.48 USD')).toHaveLength(2);
    expect(within(row).queryByText('−−23.48 USD')).not.toBeInTheDocument();
    expect(within(row).getByText('Credit note')).toBeInTheDocument();
  });

  it('says which runs no longer agree with ERPNext', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(
      workspace({
        rows: [{ ...creditRun, status: 'Invoice Drafted', needs_reconciliation: true }],
      })
    );
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    const row = (await screen.findByText('BR-2026-10-004')).closest('tr') as HTMLElement;

    expect(within(row).getByText('Out of sync')).toBeInTheDocument();
  });

  it('nets the credits off the invoiced totals it is given', async () => {
    vi.mocked(internal.getBillingWorkspace).mockResolvedValue(
      workspace({
        figures: {
          runs: 2,
          settled: 2,
          awaiting: 0,
          blocked: 0,
          blocked_lines: 0,
          invoiced_totals: [{ currency: 'USD', amount: 76.52 }],
        },
      })
    );
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw();

    expect(await screen.findByText('76.52 USD')).toBeInTheDocument();
  });
});
