import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { ItemIntegrityRow } from '@/lib/api/internal';
import ItemIntegrityReview from './ItemIntegrityReview';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, auditItemIntegrity: vi.fn(), restoreItemState: vi.fn() };
});

const row = (overrides: Partial<ItemIntegrityRow> = {}): ItemIntegrityRow =>
  ({
    item_code: 'SVC-LEGACY',
    item_name: 'Legacy service',
    disabled: 1,
    modified: '2026-09-01 06:00:00',
    modified_by: 'Administrator',
    is_stock_item: 0,
    is_sales_item: 1,
    stock_uom: 'Unit',
    sales_uom: 'Unit',
    has_month_uom: true,
    month_conversion_factor: 1,
    msp_service_scope: 'User',
    msp_invoice_label: null,
    msp_service_enabled: 0,
    open_msp_assignments: 2,
    historical_msp_assignments: 3,
    msp_contract_references: 1,
    msp_billing_line_references: 4,
    import_mapping_reference: false,
    disabled_last_changed_at: '2026-09-01 06:00:00',
    disabled_last_changed_by: 'Administrator',
    previous_disabled_value: 0,
    stock_uom_last_changed_at: null,
    previous_stock_uom: null,
    sales_uom_last_changed_at: null,
    previous_sales_uom: null,
    evidence_level: 'HIGH',
    group: 'Safe to restore',
    restorable: {
      disabled: {
        previous: 0,
        current: 1,
        changed_at: '2026-09-01 06:00:00',
        changed_by: 'Administrator',
        source_of_evidence: 'Version disabled change recorded 2026-09-01 06:00:00',
      },
    },
    ...overrides,
  }) as ItemIntegrityRow;

const show = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ItemIntegrityReview />
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('SVC-LEGACY');
};

beforeEach(() => {
  vi.mocked(internal.auditItemIntegrity).mockResolvedValue({
    rows: [
      row(),
      row({
        item_code: 'SVC-DOUBT',
        item_name: 'Ambiguous service',
        evidence_level: 'MEDIUM',
        group: 'Needs review',
        restorable: {},
      }),
    ],
    groups: {},
    generated_at: '2026-09-24 06:00:00',
  } as never);
  vi.mocked(internal.restoreItemState).mockResolvedValue({ results: [], restored: 1, failed: 0 });
});

afterEach(cleanup);

describe('the item integrity review', () => {
  it('says what it is and that nothing changes on its own', async () => {
    await show();

    expect(screen.getByRole('heading', { name: 'Item integrity review' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Review Item changes detected around MSP catalogue and billing configuration. Nothing is changed until you select records and confirm the exact values to restore.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Safe to restore')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('No change recommended')).toBeInTheDocument();
  });

  it('offers a restore only where the previous value is proven', async () => {
    await show();

    const proven = screen.getByText('SVC-LEGACY').closest('tr') as HTMLElement;
    const ambiguous = screen.getByText('SVC-DOUBT').closest('tr') as HTMLElement;

    expect(within(proven).getByRole('button', { name: 'Restore proven state' })).toBeInTheDocument();
    expect(within(ambiguous).getByText('Review')).toBeInTheDocument();
    expect(within(ambiguous).queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });

  it('asks before restoring, and sends the state the audit saw', async () => {
    await show();

    const proven = screen.getByText('SVC-LEGACY').closest('tr') as HTMLElement;
    fireEvent.click(within(proven).getByRole('button', { name: 'Restore proven state' }));

    expect(screen.getByText('Restore selected Item states?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Only the values shown below will be restored. MSP assignments, contracts, invoices and billing history will not be changed.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore selected values' }));

    await waitFor(() =>
      expect(vi.mocked(internal.restoreItemState).mock.calls[0][0]).toEqual([
        { item: 'SVC-LEGACY', fields: { disabled: 1 } },
      ])
    );
  });

  it('says plainly when part of the batch failed', async () => {
    vi.mocked(internal.restoreItemState).mockResolvedValue({
      results: [{ item: 'SVC-LEGACY', ok: false, code: 'ITEM_CHANGED_SINCE_AUDIT' }],
      restored: 0,
      failed: 1,
    });
    await show();

    const proven = screen.getByText('SVC-LEGACY').closest('tr') as HTMLElement;
    fireEvent.click(within(proven).getByRole('button', { name: 'Restore proven state' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected values' }));

    expect(await screen.findByText('Some Item states could not be restored.')).toBeInTheDocument();
    expect(
      screen.getByText('Successful changes were kept. Review the failed rows before trying again.')
    ).toBeInTheDocument();
  });
});
