import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import CreditNoteModal from './CreditNoteModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, getCreditableLines: vi.fn(), createCreditNote: vi.fn() };
});

const line = (overrides: Record<string, unknown> = {}) => ({
  service_assignment: 'SA-1',
  service_item: 'SVC',
  service_name: 'Mailbox',
  user_name: 'Abbas',
  client_user: 'CU-1',
  managed_device: null,
  hostname: null,
  assignment_scope: 'User',
  quantity: 1,
  unit_rate: 3000,
  billable_months: 3,
  amount: 9000,
  credited_months: 0,
  remaining_months: 3,
  exception_code: null,
  owed_back: null,
  ...overrides,
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  run: 'BR-1',
  customer: 'Kakivu Mousse USD',
  invoice: 'ACC-SINV-1',
  invoice_submitted: true,
  period_label: 'Q3 2026',
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  proration_method: '30-Day Convention',
  billed_in_advance: true,
  currency: 'XAF',
  lines: [line()],
  owed_back_months: 0,
  ...overrides,
});

const show = (data: ReturnType<typeof payload>) => {
  vi.mocked(internal.getCreditableLines).mockResolvedValue(data as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreditNoteModal open run="BR-1" onClose={() => {}} onCreated={() => {}} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.mocked(internal.createCreditNote).mockResolvedValue({ name: 'BR-2' } as never);
});

afterEach(cleanup);

describe('what the invoice owes back', () => {
  it('says nothing when every service ran to the end of the period', async () => {
    show(payload());

    await screen.findByText('Mailbox');
    expect(screen.queryByText(/stopped before the period/)).not.toBeInTheDocument();
  });

  it('names the lines that stopped early and what they owe', async () => {
    show(
      payload({
        owed_back_months: 0.2,
        lines: [
          line({
            owed_back: {
              ended_on: '2026-09-24',
              unused_from: '2026-09-25',
              unused_to: '2026-09-30',
              unused_days: 6,
              months: 0.2,
            },
          }),
        ],
      })
    );

    expect(await screen.findByText(/1 line\(s\) stopped before the period/)).toBeInTheDocument();
    expect(screen.getByText(/0.2 month\(s\) were charged for days nobody was served/)).toBeInTheDocument();
    expect(screen.getByText(/ended 2026-09-24 · 6 day\(s\) unused/)).toBeInTheDocument();
  });

  it('takes the proposal as it stands and credits exactly what is owed', async () => {
    show(
      payload({
        owed_back_months: 0.2,
        lines: [
          line({
            owed_back: {
              ended_on: '2026-09-24',
              unused_from: '2026-09-25',
              unused_to: '2026-09-30',
              unused_days: 6,
              months: 0.2,
            },
          }),
        ],
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: /Give those days back/ }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ended on 24 September.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare credit note' }));

    await waitFor(() =>
      expect(vi.mocked(internal.createCreditNote).mock.calls[0][0]).toEqual({
        name: 'BR-1',
        lines: [{ service_assignment: 'SA-1', months: 0.2 }],
        reason: 'Ended on 24 September.',
      })
    );
  });
});

describe('crediting a stretch that was not served', () => {
  it('sends the dates and lets the server cut them the contract way', async () => {
    show(payload());

    await screen.findByText('Mailbox');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'By period' }));

    const dates = screen.getAllByDisplayValue('');
    fireEvent.change(dates[0], { target: { value: '2026-09-05' } });
    fireEvent.change(dates[1], { target: { value: '2026-09-13' } });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Their server was down.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare credit note' }));

    await waitFor(() =>
      expect(vi.mocked(internal.createCreditNote).mock.calls[0][0]).toEqual({
        name: 'BR-1',
        lines: [{ service_assignment: 'SA-1', from: '2026-09-05', to: '2026-09-13' }],
        reason: 'Their server was down.',
      })
    );
  });

  it('counts the days so nobody has to work out the months', async () => {
    show(payload());

    await screen.findByText('Mailbox');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'By period' }));

    const dates = screen.getAllByDisplayValue('');
    fireEvent.change(dates[0], { target: { value: '2026-09-05' } });
    fireEvent.change(dates[1], { target: { value: '2026-09-13' } });

    expect(screen.getByText('9 day(s)')).toBeInTheDocument();
  });

  it('refuses to send until both dates are given', async () => {
    show(payload());

    await screen.findByText('Mailbox');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'By period' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Because.' } });

    expect(screen.getByRole('button', { name: 'Prepare credit note' })).toBeDisabled();
  });
});
