import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type {
  BillingOperationAccounting,
  BillingOperationContext,
  BillingOperationServices,
} from '@/lib/api/internal';
import NewBillingRun from './NewBillingRun';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();

  return {
    ...actual,
    getBillingOperationContext: vi.fn(),
    getBillingOperationServices: vi.fn(),
    getBillingOperationAccounting: vi.fn(),
    getBillingCreditPreview: vi.fn(),
    createBillingOperation: vi.fn(),
    listMspContracts: vi.fn(),
  };
});

const context = (overrides: Partial<BillingOperationContext> = {}): BillingOperationContext => ({
  kind: 'period',
  label: 'Regular billing',
  contract: 'CON-0001',
  contract_title: 'ACME Managed Services',
  customer: 'ACME',
  currency: 'XAF',
  billing_frequency: 'Monthly',
  billing_timing: 'In Arrears',
  proration_method: 'Daily Actual Days',
  invoice_grouping: 'One Invoice',
  contract_start: '2024-01-01',
  contract_end: null,
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  period_locked: false,
  note: 'Billing in arrears.',
  note_tone: 'blue',
  proposed_lines: 2,
  proposed_amount: 400,
  source_run: null,
  open_run: null,
  ...overrides,
});

const services = (overrides: Partial<BillingOperationServices> = {}): BillingOperationServices => ({
  kind: 'period',
  scope: 'detected',
  currency: 'XAF',
  source_run: null,
  lines: [
    {
      id: 'SA-1',
      service: 'Mailbox',
      service_item: 'SVC-MBX',
      assignment: 'SA-1',
      person: 'John Doe',
      device: null,
      covered_from: '2026-09-01',
      covered_to: '2026-09-30',
      segments: [],
      months: 1,
      days: 30,
      quantity: 1,
      rate: 200,
      amount: 200,
      exception_code: null,
      exception_detail: null,
      reason: 'Delivered over the period being billed.',
      covered: 'Covered by the contract',
      proof: false,
      eligible: true,
    },
  ],
  blocked: [
    {
      id: 'SA-2',
      service: 'Antivirus',
      service_item: 'SVC-AV',
      assignment: 'SA-2',
      person: 'Jane Roe',
      device: 'LAP-02',
      covered_from: null,
      covered_to: null,
      segments: [],
      months: 0,
      days: 0,
      quantity: 1,
      rate: null,
      amount: 0,
      exception_code: 'Missing Rate',
      exception_detail: 'No rate for this service.',
      reason: 'No rate for this service.',
      covered: 'Covered by the contract',
      proof: false,
      eligible: false,
    },
  ],
  note: null,
  ...overrides,
});

const accounting = (): BillingOperationAccounting => ({
  dimensions: [
    {
      fieldname: 'cost_center',
      label: 'Cost Center',
      document_type: 'Cost Center',
      mandatory: true,
      default: 'Main - NX',
      options: ['Main - NX', 'Managed Services - NX'],
    },
  ],
  currency: 'XAF',
  company_currency: 'XAF',
  posting_date: '2026-10-20',
  payment_terms: 'Net 30 Days',
  billing_contact: 'finance@acme.example',
  billing_contact_note: null,
});

const draw = (search = '?kind=period&contract=CON-0001&start=2026-09-01&end=2026-09-30') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/msp/billing/new${search}`]}>
        <NewBillingRun />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const ready = () => {
  vi.mocked(internal.getBillingOperationContext).mockResolvedValue(context());
  vi.mocked(internal.getBillingOperationServices).mockResolvedValue(services());
  vi.mocked(internal.getBillingOperationAccounting).mockResolvedValue(accounting());
  vi.mocked(internal.listMspContracts).mockResolvedValue([]);
};

const forward = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
};

/** The services step only lets go once its candidates are in and selected. */
const throughServices = async () => {
  await screen.findByText('Review services');
  await screen.findByText('1 selected');
  await forward();
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('one path prepares the three operations', () => {
  it('opens on the context of the proposal it was started from', async () => {
    ready();
    draw();

    expect(await screen.findByText('Contract & period')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.getByText(/Billing in arrears/)).toBeInTheDocument();
  });

  it('walks four steps and no more', async () => {
    ready();
    draw();

    await screen.findByText('Contract & period');
    await forward();
    expect(await screen.findByText('Review services')).toBeInTheDocument();
    await screen.findByText('1 selected');
    await forward();
    expect(await screen.findByText('Accounting & notifications')).toBeInTheDocument();
    await screen.findByText('Main - NX');
    await forward();
    expect(await screen.findByText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.getAllByText('Confirm').length).toBeGreaterThan(0);
  });

  it('holds back what cannot be billed instead of hiding it', async () => {
    ready();
    draw();

    await screen.findByText('Contract & period');
    await forward();

    expect(await screen.findByText(/1 line cannot be billed/)).toBeInTheDocument();
    expect(screen.getByText('Missing Rate')).toBeInTheDocument();
  });

  it('refuses to go on with nothing selected', async () => {
    ready();
    draw();

    await screen.findByText('Contract & period');
    await forward();
    await screen.findByText('Review services');
    await screen.findByText('1 selected');

    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    await forward();

    expect(await screen.findByRole('alert')).toHaveTextContent('Select at least one service');
  });

  it('asks the accounting questions where the document is prepared', async () => {
    ready();
    draw();

    await screen.findByText('Contract & period');
    await forward();
    await throughServices();

    expect(await screen.findByText(/Cost Center/)).toBeInTheDocument();
    expect(screen.getByText('finance@acme.example')).toBeInTheDocument();
    expect(screen.getByText(/drafted first; submitting it is a separate decision/)).toBeInTheDocument();
  });

  it('sends one call when the operation is confirmed', async () => {
    ready();
    vi.mocked(internal.createBillingOperation).mockResolvedValue({
      run: 'BR-2026-09-001',
      kind: 'period',
    });
    draw();

    await screen.findByText('Contract & period');
    await forward();
    await throughServices();
    await screen.findByText('Accounting & notifications');
    await screen.findByText('Main - NX');
    await forward();
    await screen.findByText('Step 4 of 4');

    fireEvent.click(screen.getByRole('button', { name: /Prepare invoice draft/ }));

    await waitFor(() => expect(internal.createBillingOperation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.createBillingOperation).mock.calls[0][0]).toMatchObject({
      kind: 'period',
      contract: 'CON-0001',
      include: ['SA-1'],
      draft_invoice: 1,
    });
  });

  it('says a credit stands on a verification, once, not line by line', async () => {
    vi.mocked(internal.getBillingOperationContext).mockResolvedValue(
      context({ kind: 'credit_note', label: 'Credit note', note: 'Credit for coverage already billed.' })
    );
    vi.mocked(internal.getBillingOperationServices).mockResolvedValue(
      services({
        kind: 'credit_note',
        lines: [
          {
            ...services().lines[0],
            amount: -140,
            covered: 'History to verify',
            proof: true,
            reason: 'Service ended inside a period charged in advance.',
          },
        ],
        blocked: [],
      })
    );
    vi.mocked(internal.getBillingOperationAccounting).mockResolvedValue(accounting());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw('?kind=credit_note&contract=CON-0001&scope=detected&start=2026-09-25&end=2026-09-30');

    await screen.findByText('Contract & period');
    await forward();

    expect(await screen.findByText(/Credit detected on this charge/)).toBeInTheDocument();
    expect(screen.queryByText(/Original billed coverage/)).not.toBeInTheDocument();
  });

  it('opens the whole charge for the operator to cut when asked to', async () => {
    vi.mocked(internal.getBillingOperationContext).mockResolvedValue(
      context({ kind: 'credit_note', label: 'Credit note' })
    );
    vi.mocked(internal.getBillingOperationServices).mockResolvedValue(
      services({
        kind: 'credit_note',
        scope: 'all',
        source_run: 'BR-2026-10-165',
        source_invoice: 'ACC-SINV-2026-00031',
        lines: [
          {
            ...services().lines[0],
            amount: -200,
            covered: 'On this charge',
            proof: true,
            editable: true,
            reason: 'Billed 1 months over 2026-09-01 – 2026-09-30. Choose the stretch to give back.',
          },
        ],
        blocked: [],
      })
    );
    vi.mocked(internal.getBillingOperationAccounting).mockResolvedValue(accounting());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    vi.mocked(internal.createBillingOperation).mockResolvedValue({
      run: 'BR-2026-10-900',
      kind: 'credit_note',
    });
    vi.mocked(internal.getBillingCreditPreview).mockResolvedValue({
      run: 'BR-2026-10-165',
      currency: 'XAF',
      lines: [
        {
          service_assignment: 'SA-1',
          service_name: 'Mailbox',
          user_name: 'John Doe',
          covered_from: '2026-09-05',
          covered_to: '2026-09-13',
          months: -0.3,
          unit_rate: 200,
          discount_percent: 0,
          amount: -60,
        },
      ],
      total: -60,
    });
    draw('?kind=credit_note&contract=CON-0001&against=BR-2026-10-165&scope=all&start=2026-09-01&end=2026-09-30');

    await screen.findByText('Contract & period');
    await forward();

    expect(await screen.findByText(/Every line of this charge/)).toBeInTheDocument();
    // nothing is given back until somebody says so
    expect(screen.getByText('0 selected')).toBeInTheDocument();

    const from = screen.getByLabelText('Credit Mailbox from') as HTMLInputElement;
    const to = screen.getByLabelText('Credit Mailbox to') as HTMLInputElement;

    expect(from.value).toBe('2026-09-01');
    expect(to.value).toBe('2026-09-30');

    fireEvent.click(screen.getByRole('checkbox', { name: /Include Mailbox/ }));
    fireEvent.change(from, { target: { value: '2026-09-05' } });
    fireEvent.change(to, { target: { value: '2026-09-13' } });

    await forward();
    await screen.findByText(/A credit follows the document it stands against/);
    expect(screen.getByText(/ACC-SINV-2026-00031/)).toBeInTheDocument();
    await forward();
    await waitFor(() => expect(internal.getBillingCreditPreview).toHaveBeenCalled());
    await screen.findByText('Step 4 of 4');

    // the amount shown is the one the engine priced for the days actually chosen
    expect(await screen.findByText(/60\.00 XAF/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Prepare credit note/ }));

    // a credit on days that were served does not go through without a reason
    expect(await screen.findByRole('alert')).toHaveTextContent('Say why these days');
    expect(internal.createBillingOperation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Why these days are given back/), {
      target: { value: 'Settled: the service was unusable.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Prepare credit note/ }));

    await waitFor(() => expect(internal.createBillingOperation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.createBillingOperation).mock.calls[0][0]).toMatchObject({
      kind: 'credit_note',
      against: 'BR-2026-10-165',
      scope: 'all',
      reason: 'Settled: the service was unusable.',
      include: [{ service_assignment: 'SA-1', from: '2026-09-05', to: '2026-09-13' }],
    });
  });

  it('refuses to go on with a line ticked and no days given', async () => {
    vi.mocked(internal.getBillingOperationContext).mockResolvedValue(
      context({ kind: 'credit_note', label: 'Credit note' })
    );
    vi.mocked(internal.getBillingOperationServices).mockResolvedValue(
      services({
        kind: 'credit_note',
        scope: 'all',
        source_run: 'BR-1',
        lines: [{ ...services().lines[0], covered_from: null, covered_to: null, editable: true }],
        blocked: [],
      })
    );
    vi.mocked(internal.getBillingOperationAccounting).mockResolvedValue(accounting());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw('?kind=credit_note&contract=CON-0001&against=BR-1&scope=all&start=2026-09-01&end=2026-09-30');

    await screen.findByText('Contract & period');
    await forward();
    await screen.findByText(/Every line of this charge/);

    fireEvent.click(screen.getByRole('checkbox', { name: /Include Mailbox/ }));
    await forward();

    expect(await screen.findByRole('alert')).toHaveTextContent('Give the days to credit');
  });

  it('draws a credit of its own when there is no document to copy from', async () => {
    vi.mocked(internal.getBillingOperationContext).mockResolvedValue(
      context({ kind: 'credit_note', label: 'Credit note' })
    );
    vi.mocked(internal.getBillingOperationServices).mockResolvedValue(
      services({
        kind: 'credit_note',
        scope: 'all',
        source_run: 'BR-2026-08-002',
        source_invoice: null,
        lines: [{ ...services().lines[0], editable: true, proof: true }],
        blocked: [],
      })
    );
    vi.mocked(internal.getBillingOperationAccounting).mockResolvedValue(accounting());
    vi.mocked(internal.listMspContracts).mockResolvedValue([]);
    draw('?kind=credit_note&contract=CON-0001&against=BR-2026-08-002&scope=all&start=2026-09-01&end=2026-09-30');

    await screen.findByText('Contract & period');
    await forward();
    await screen.findByText(/Every line of this charge/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Include Mailbox/ }));
    await forward();

    expect(await screen.findByText(/A credit note of its own/)).toBeInTheDocument();
    expect(screen.getByText(/drawn on the company defaults/)).toBeInTheDocument();
  });
});
