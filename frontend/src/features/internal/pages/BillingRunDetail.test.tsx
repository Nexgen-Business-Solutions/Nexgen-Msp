import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { BillingRunView } from '@/lib/api/internal';
import BillingRunDetail from './BillingRunDetail';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();

  return {
    ...actual,
    getBillingRunView: vi.fn(),
    runBillingAction: vi.fn(),
    getInvoiceRecipients: vi.fn(),
    getInvoiceDimensions: vi.fn(),
  };
});

const NAME = 'BR-2026-10-005';

const view = (overrides: Partial<BillingRunView> = {}): BillingRunView =>
  ({
    name: NAME,
    customer: 'Kakivu Mousse USD',
    billing_identity: {
      customer_name_snapshot: 'Kakivu Mousse USD',
      tax_id_snapshot: null,
      billing_address_snapshot: null,
      billing_contact_snapshot: null,
    },
    contract: 'CON-0001',
    contract_title: 'Kakivu managed services',
    billing_frequency: 'Quarterly',
    billing_timing: 'In Advance',
    proration_method: 'Daily Actual Days',
    period_label: 'Q3 2026',
    status: 'Invoiced',
    docstatus: 1,
    billing_period_start: '2026-07-01',
    billing_period_end: '2026-09-30',
    cutoff_datetime: null,
    currency: 'USD',
    total_amount: 49.03,
    exception_count: 0,
    prepared_by: 'Billing desk',
    approved_by: 'Billing desk',
    approved_at: '2026-10-20 09:00:00',
    sales_order: null,
    sales_invoice: 'R-SINV-2026-00022',
    invoice_status: 'Return',
    invoice_submitted: true,
    invoice_docstatus: 1,
    accounting_state: 'Posted',
    invoice_amended_to: null,
    accounting_mismatch: null,
    reconstructed: false,
    coverage_evidence: null,
    adjustment_of: null,
    credit_note_of: 'BR-2026-07-001',
    credit_note_reason: 'Services not served',
    disputed: false,
    dispute_reason: null,
    disputed_on: null,
    dispute_request: null,
    can_resolve_dispute: false,
    can_discount_lines: false,
    discount_percent: 0,
    is_credit_note: true,
    lines: [],
    can_approve: false,
    can_revalidate: false,
    can_invoice: false,
    can_cancel: true,
    cancel_blocked: null,
    can_reconcile: false,
    cancellation: null,
    can_submit_invoice: false,
    can_contest: false,
    can_discard_invoice: false,
    can_reopen: false,
    kind: 'Credit note',
    credit_detected: null,
    stage: 3,
    stages: ['Validation', 'Approval', 'Invoice', 'Posted'],
    settled: true,
    moves: [{ action: 'cancel', label: 'Cancel run and credit note', look: 'danger' }],
    activity: [{ label: 'Billing run created', by: 'Billing desk', on: null }],
    figures: {
      amount: 49.03,
      currency: 'USD',
      lines: 0,
      billed_lines: 0,
      exceptions: 0,
      months: 0,
      people: 0,
      devices: 0,
    },
    as_of: '2026-10-28',
    ...overrides,
  }) as BillingRunView;

const draw = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/msp/billing/${NAME}`]}>
        <Routes>
          <Route path="/msp/billing/:name" element={<BillingRunDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const dialog = () => screen.getByRole('dialog');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('cancelling a billing run', () => {
  it('asks before anything, naming the run and the document that goes with it', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(view());
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run and credit note' }));

    const asked = dialog();

    expect(within(asked).getByText('Cancel Billing Run?')).toBeInTheDocument();
    expect(
      within(asked).getByText(
        `${NAME} and its credit note R-SINV-2026-00022 are cancelled together, or neither is.`
      )
    ).toBeInTheDocument();
    expect(within(asked).getByText(/is posted in ERPNext/)).toBeInTheDocument();
    expect(internal.runBillingAction).not.toHaveBeenCalled();
  });

  it('will not cancel until a reason is given, and sends the reason with it', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(view());
    vi.mocked(internal.runBillingAction).mockResolvedValue(
      view({ status: 'Cancelled' }) as never
    );
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run and credit note' }));

    const confirm = within(dialog()).getByRole('button', { name: 'Cancel Billing Run' });

    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog()).getByLabelText('Cancellation reason'), {
      target: { value: 'Billing correction approved by accounting' },
    });

    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(internal.runBillingAction).toHaveBeenCalledWith('cancel', NAME, {
        reason: 'Billing correction approved by accounting',
      })
    );
  });

  it('says a draft is deleted rather than cancelled', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(
      view({
        status: 'Invoice Drafted',
        invoice_submitted: false,
        invoice_docstatus: 0,
        accounting_state: 'Draft',
        settled: false,
        moves: [{ action: 'cancel', label: 'Cancel run and credit note', look: 'danger' }],
      })
    );
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run and credit note' }));

    expect(within(dialog()).getByText(/is still a draft, so it is deleted/)).toBeInTheDocument();
    expect(screen.getByText('draft — not posted yet')).toBeInTheDocument();
  });

  it('keeps the run when the ledger refuses, and says why', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(view());
    vi.mocked(internal.runBillingAction).mockRejectedValue(
      new Error('ERPNext could not cancel R-SINV-2026-00022: an accounting dependency prevents it.')
    );
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run and credit note' }));
    fireEvent.change(within(dialog()).getByLabelText('Cancellation reason'), {
      target: { value: 'Billing correction' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel Billing Run' }));

    expect(
      await screen.findByText(
        'ERPNext could not cancel R-SINV-2026-00022: an accounting dependency prevents it.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog'), 'the dialog stays open to try again').toBeInTheDocument();
  });

  it('offers nothing to cancel on a run already cancelled, and says what was undone', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(
      view({
        status: 'Cancelled',
        can_cancel: false,
        moves: [],
        invoice_docstatus: 2,
        accounting_state: 'Cancelled',
        invoice_submitted: false,
        cancellation: {
          operation: 'cancel-posted',
          reason: 'Billing correction approved by accounting',
          by: 'billing@nexgen.test',
          at: '2026-10-28 06:00:00',
          on: '2026-10-28 06:00:00',
          before: { run: 'Invoiced', document: 'R-SINV-2026-00022', invoice_docstatus: 1 },
          after: { run: 'Cancelled', document: 'R-SINV-2026-00022', invoice_docstatus: 2 },
        },
      })
    );
    draw();

    expect(await screen.findByText('This run was cancelled.')).toBeInTheDocument();
    expect(
      screen.getByText(/Billing correction approved by accounting/)
    ).toBeInTheDocument();
    expect(screen.getByText(/R-SINV-2026-00022 was cancelled in ERPNext with it/)).toBeInTheDocument();
    expect(screen.getByText('cancelled in ERPNext')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Cancel run/ })
    ).not.toBeInTheDocument();
  });
});

describe('when the run and ERPNext do not agree', () => {
  it('says so where the run is read, and offers to bring it up to date', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(
      view({
        status: 'Invoice Drafted',
        settled: false,
        can_reconcile: true,
        accounting_mismatch: {
          code: 'POSTED_ELSEWHERE',
          message:
            'R-SINV-2026-00022 is posted in ERPNext while this run still reads Invoice Drafted. Reconcile the run to bring it up to date.',
        },
        moves: [{ action: 'reconcile', label: 'Reconcile with ERPNext', look: 'warn' }],
      })
    );
    vi.mocked(internal.runBillingAction).mockResolvedValue(
      view({ status: 'Invoiced' }) as never
    );
    draw();

    expect(await screen.findByText('This run and ERPNext do not agree.')).toBeInTheDocument();
    expect(screen.getByText(/is posted in ERPNext while this run still reads/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reconcile →' }));

    expect(within(dialog()).getByText('Reconcile with ERPNext?')).toBeInTheDocument();
    expect(
      within(dialog()).getByText(/Nothing is posted, re-posted or raised/)
    ).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reconcile the run' }));

    await waitFor(() =>
      expect(internal.runBillingAction).toHaveBeenCalledWith('reconcile', NAME, { apply: 1 })
    );
  });

  it('shows the replacement of an amended document without following it', async () => {
    vi.mocked(internal.getBillingRunView).mockResolvedValue(
      view({
        invoice_docstatus: 2,
        accounting_state: 'Cancelled',
        invoice_submitted: false,
        invoice_amended_to: 'R-SINV-2026-00022-1',
      })
    );
    draw();

    expect(await screen.findByText('The document was amended in ERPNext.')).toBeInTheDocument();
    expect(
      screen.getByText(/R-SINV-2026-00022 was replaced by R-SINV-2026-00022-1/)
    ).toBeInTheDocument();
  });
});
