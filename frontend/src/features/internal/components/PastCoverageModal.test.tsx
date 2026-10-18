import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import PastCoverageModal from './PastCoverageModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getCoverageEvidence: vi.fn(),
    previewPastCoverage: vi.fn(),
    recordPastCoverage: vi.fn(),
  };
});

const evidence = (overrides: Record<string, unknown> = {}) => ({
  customer: 'Kakivu',
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  runs: [],
  invoices: [],
  contracts: [
    {
      name: 'CON-2026-0003',
      title: 'SLA - Kakivu',
      billing_frequency: 'Quarterly',
      billing_timing: 'In Advance',
      proration_method: '30-Day Convention',
      start_date: '2023-01-01',
      end_date: null,
    },
  ],
  ...overrides,
});

const preview = {
  contract: 'CON-2026-0003',
  customer: 'Kakivu',
  currency: 'XAF',
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  lines: [{ service_assignment: 'SA-2026-00063', exception_code: null }],
  total_amount: 9000,
};

const recorded = vi.fn();

const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PastCoverageModal
        open
        customers={[{ value: 'Kakivu', label: 'Kakivu' }]}
        defaultCustomer="Kakivu"
        onClose={() => {}}
        onRecorded={recorded}
      />
    </QueryClientProvider>
  );

const askFor = async (from = '2026-07-01', to = '2026-09-30') => {
  fireEvent.change(screen.getByLabelText('Period charged, from'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
  fireEvent.click(screen.getByRole('button', { name: 'Find the evidence' }));
  await screen.findByText('What this application found');
};

beforeEach(() => {
  recorded.mockClear();
  vi.mocked(internal.getCoverageEvidence).mockResolvedValue(evidence() as never);
  vi.mocked(internal.previewPastCoverage).mockResolvedValue(preview as never);
  vi.mocked(internal.recordPastCoverage).mockResolvedValue({ name: 'BR-2026-07-900' } as never);
});

afterEach(cleanup);

describe('recording a charge raised before this application', () => {
  it('asks for the customer and the period before it shows anything', () => {
    show();

    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.queryByText('What this application found')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find the evidence' })).toBeDisabled();
  });

  it('looks for nothing until a customer is named', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PastCoverageModal
          open
          customers={[{ value: 'Kakivu', label: 'Kakivu' }]}
          onClose={() => {}}
          onRecorded={recorded}
        />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText('Period charged, from'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });

    expect(screen.getByRole('button', { name: 'Find the evidence' })).toBeDisabled();
    expect(vi.mocked(internal.getCoverageEvidence)).not.toHaveBeenCalled();
  });

  it('says plainly when it found nothing to go on', async () => {
    show();
    await askFor();

    expect(
      screen.getByText('No billing run covers any part of this period.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No posted invoice of this customer sits near these dates.')
    ).toBeInTheDocument();
  });

  it('lists the evidence it did find', async () => {
    vi.mocked(internal.getCoverageEvidence).mockResolvedValue(
      evidence({
        invoices: [
          { name: 'ACC-SINV-2026-0007', posting_date: '2026-07-24', currency: 'XAF', grand_total: 9000 },
        ],
      }) as never
    );
    show();
    await askFor();

    expect(screen.getByText(/1 posted invoice\(s\) around these dates/)).toBeInTheDocument();
    expect(screen.getByText('The original invoice, if it is one of these')).toBeInTheDocument();
  });

  it('shows what the period would have held once a contract is chosen', async () => {
    show();
    await askFor();

    fireEvent.click(screen.getByText('Choose the contract'));
    fireEvent.click(await screen.findByRole('option', { name: /SLA - Kakivu/ }));

    expect(await screen.findByText(/9 000 XAF/)).toBeInTheDocument();
  });

  it('refuses to record without a statement of where the charge came from', async () => {
    show();
    await askFor();

    fireEvent.click(screen.getByText('Choose the contract'));
    fireEvent.click(await screen.findByRole('option', { name: /SLA - Kakivu/ }));
    await screen.findByText(/9 000 XAF/);

    expect(screen.getByRole('button', { name: 'Record as charged' })).toBeDisabled();
  });

  it('records the period, the contract and the statement', async () => {
    show();
    await askFor();

    fireEvent.click(screen.getByText('Choose the contract'));
    fireEvent.click(await screen.findByRole('option', { name: /SLA - Kakivu/ }));
    await screen.findByText(/9 000 XAF/);
    fireEvent.change(screen.getByLabelText('Where this charge came from'), {
      target: { value: 'Charged by the previous system, invoice KAK-2026-Q3.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record as charged' }));

    await waitFor(() =>
      expect(vi.mocked(internal.recordPastCoverage)).toHaveBeenCalledWith({
        contract: 'CON-2026-0003',
        period_start: '2026-07-01',
        period_end: '2026-09-30',
        statement: 'Charged by the previous system, invoice KAK-2026-Q3.',
        sales_invoice: null,
      })
    );
    expect(recorded).toHaveBeenCalledWith('BR-2026-07-900');
  });

  it('will not record a period nothing was running in', async () => {
    vi.mocked(internal.previewPastCoverage).mockResolvedValue({
      ...preview,
      lines: [{ service_assignment: 'SA-1', exception_code: 'Already Covered' }],
      total_amount: 0,
    } as never);
    show();
    await askFor();

    fireEvent.click(screen.getByText('Choose the contract'));
    fireEvent.click(await screen.findByRole('option', { name: /SLA - Kakivu/ }));

    expect(await screen.findByText(/Nothing was running over this period/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Where this charge came from'), {
      target: { value: 'Anything' },
    });
    expect(screen.getByRole('button', { name: 'Record as charged' })).toBeDisabled();
  });
});
