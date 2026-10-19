import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import CreditNoteModal from './CreditNoteModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, getCreditableLines: vi.fn(), createCreditNote: vi.fn() };
});

const line = (assignment: string, owed: number | null) => ({
  service_assignment: assignment,
  service_item: 'SVC',
  service_name: 'Parallels',
  user_name: assignment,
  quantity: 1,
  unit_rate: 700,
  billable_months: 3,
  credited_months: 0,
  remaining_months: 3,
  exception_code: null,
  owed_back: owed
    ? {
        ended_on: '2026-09-24',
        unused_from: '2026-09-25',
        unused_to: '2026-09-30',
        unused_days: 6,
        months: owed,
      }
    : null,
});

const source = {
  run: 'BR-1',
  customer: 'Kakivu',
  invoice: null,
  invoice_submitted: false,
  reconstructed: true,
  coverage_evidence: 'Charged before this application.',
  period_label: 'Q3 2026',
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  proration_method: '30-Day Convention',
  billed_in_advance: true,
  currency: 'XAF',
  owed_back_months: 0.4,
  lines: [line('Abbas', 0.2), line('Nobody', null), line('Alaa', 0.2)],
};

const show = (preselectOwed: boolean) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CreditNoteModal
        open
        run="BR-1"
        preselectOwed={preselectOwed}
        onClose={() => {}}
        onCreated={() => {}}
      />
    </QueryClientProvider>
  );

beforeEach(() => {
  vi.mocked(internal.getCreditableLines).mockResolvedValue(source as never);
});

afterEach(cleanup);

describe('arriving from what the charged period left behind', () => {
  it('ticks the lines that owe days back, and only those', async () => {
    show(true);

    await waitFor(() => expect(screen.getByText(/to credit/)).toBeInTheDocument());

    // only the lines that owe days are listed, and all of them are ticked
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, true]);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Abbas');
    expect(screen.queryByText('Nobody')).not.toBeInTheDocument();
  });

  it('asks for the amount owed back and nothing more', async () => {
    show(true);

    // 0.2 + 0.2 month at 700, and the line that owes nothing left alone
    expect(await screen.findByText(/280 XAF/)).toBeInTheDocument();
  });

  it('opened the ordinary way, it ticks nothing', async () => {
    show(false);

    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });
});
