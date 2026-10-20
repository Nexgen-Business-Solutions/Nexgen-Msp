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
