import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { CatalogueRow } from '@/lib/api/internal';
import RemoveFromMspModal from './RemoveFromMspModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, removeServiceFromMsp: vi.fn() };
});

const service = (open: number): CatalogueRow =>
  ({
    definition: 'MSP-SVC-00001',
    name: 'SVC-M365',
    item_name: 'Microsoft 365',
    service_name: 'Microsoft 365',
    disabled: 0,
    stock_uom: 'Month',
    sales_uom: 'Month',
    is_stock_item: 0,
    is_sales_item: 1,
    scope: 'User',
    description: null,
    open_assignments: open,
    customers: 2,
    priced_contracts: 1,
    invoice_label: null,
    msp_enabled: 1,
    month_ready: true,
    ready: true,
    msp_availability: 'Available',
    erpnext_status: 'Enabled',
    compatibility_status: 'Ready',
    blockers: [],
  }) as CatalogueRow;

const show = (row: CatalogueRow, contracts = 0) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RemoveFromMspModal service={row} contracts={contracts} onClose={() => {}} />
    </QueryClientProvider>
  );

beforeEach(() => {
  vi.mocked(internal.removeServiceFromMsp).mockResolvedValue({
    name: 'SVC-M365',
    open_assignments: 0,
    ended: 0,
    failed: [],
  });
});

afterEach(cleanup);

describe('removing a service from MSP', () => {
  it('says what it does and does not touch when nothing is running', async () => {
    show(service(0));

    expect(screen.getByText('Remove Microsoft 365 from MSP?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'It will no longer be available for new MSP assignments, requests or contracts. Existing history and invoices are kept. The ERPNext Item will remain enabled.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove from MSP' }));

    await waitFor(() =>
      expect(vi.mocked(internal.removeServiceFromMsp).mock.calls[0][0]).toMatchObject({
        item: 'SVC-M365',
        mode: 'keep',
      })
    );
  });

  it('keeps running assignments by default', async () => {
    show(service(3));

    expect(
      screen.getByText('3 open assignment(s) currently use this service. Choose what should happen to them.')
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /keep existing assignments/i })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Remove from MSP' }));

    await waitFor(() =>
      expect(vi.mocked(internal.removeServiceFromMsp).mock.calls[0][0]).toMatchObject({ mode: 'keep' })
    );
  });

  it('ends everything only when that is chosen and explained', async () => {
    show(service(3));

    fireEvent.click(screen.getByRole('radio', { name: /end active assignments/i }));
    const remove = screen.getByRole('button', { name: 'Remove and end 3 assignments' });
    expect(remove).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Service withdrawn from the offer' },
    });
    fireEvent.click(remove);

    await waitFor(() =>
      expect(vi.mocked(internal.removeServiceFromMsp).mock.calls[0][0]).toMatchObject({
        mode: 'end',
        reason: 'Service withdrawn from the offer',
      })
    );
  });

  it('shows which closures failed and keeps the rest', async () => {
    vi.mocked(internal.removeServiceFromMsp).mockResolvedValue({
      name: 'SVC-M365',
      open_assignments: 3,
      ended: 2,
      failed: [{ assignment: 'SA-3', message: 'Already billed to the end of the period.' }],
    });
    show(service(3));

    fireEvent.click(screen.getByRole('radio', { name: /end active assignments/i }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Withdrawn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove and end 3 assignments' }));

    expect(
      await screen.findByText('Service removed from MSP, but some assignments could not be ended.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Successful closures were kept. Review the failed assignments below.')
    ).toBeInTheDocument();
    expect(screen.getByText('SA-3 · Already billed to the end of the period.')).toBeInTheDocument();
  });

  it('warns that live contracts are left alone', () => {
    show(service(1), 2);

    expect(
      screen.getByText(
        'This service is referenced by 2 active contract(s). Those contract records will not be changed.'
      )
    ).toBeInTheDocument();
  });
});
