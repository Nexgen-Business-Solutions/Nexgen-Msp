import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { ServiceDetail as ServiceDetailData } from '@/lib/api/internal';
import { FrappeError } from '@/lib/api/client';
import ServiceDetail from './ServiceDetail';
import ServiceRedirect from './ServiceRedirect';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, getService: vi.fn(), enableItemForMsp: vi.fn() };
});

const detail = (overrides: Record<string, unknown> = {}): ServiceDetailData =>
  ({
    service: {
      name: 'SVC/M365',
      item_name: 'Microsoft 365',
      service_name: 'Microsoft 365',
      definition: 'MSP-SVC-00001',
      in_msp: true,
      invoice_label: null,
      scope: 'User',
      description: null,
      uom: 'Month',
      disabled: 0,
      msp_enabled: true,
      is_stock_item: 0,
      is_sales_item: 1,
      stock_uom: 'Month',
      sales_uom: 'Month',
      has_month_uom: true,
      month_conversion_factor: 1,
      month_ready: true,
      billing_uom: 'Month',
      compatibility_status: 'Ready',
      blockers: [],
      ready: true,
      ...overrides,
    },
    customers: [],
    contracts: [],
    billed: { runs: 2, months: 5, amount: 400 },
    scopes: ['User', 'Device', 'Both'],
  }) as ServiceDetailData;

const show = (route: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/msp/services/detail" element={<ServiceDetail />} />
          <Route path="/msp/services/:name" element={<ServiceRedirect />} />
          <Route path="/msp/services" element={<p>the catalogue</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

beforeEach(() => {
  vi.mocked(internal.getService).mockResolvedValue(detail());
});

afterEach(cleanup);

describe('opening one service', () => {
  it('carries an Item code with a slash in it through the route', async () => {
    show('/msp/services/detail?item=SVC%2FM365');

    expect(await screen.findByRole('heading', { name: 'Microsoft 365' })).toBeInTheDocument();
    expect(vi.mocked(internal.getService).mock.calls[0][0]).toBe('SVC/M365');
  });

  it('sends an old link to the canonical one', async () => {
    show('/msp/services/SVC%2FM365');

    expect(await screen.findByRole('heading', { name: 'Microsoft 365' })).toBeInTheDocument();
  });

  it('says what the Item is in MSP and in ERPNext', async () => {
    show('/msp/services/detail?item=SVC%2FM365');

    // the two axes are read separately: what MSP says, and what ERPNext says
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('MSP availability')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('ERPNext status')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('MSP billing UOM')).toBeInTheDocument();
    expect(screen.getByText('Month · Ready')).toBeInTheDocument();
    expect(screen.getByText('MSP service definition')).toBeInTheDocument();
    expect(screen.getByText('MSP-SVC-00001')).toBeInTheDocument();
  });

  it('opens a disabled Item and says so rather than hiding it', async () => {
    vi.mocked(internal.getService).mockResolvedValue(
      detail({ disabled: 1, compatibility_status: 'ERPNext Disabled', ready: false })
    );
    show('/msp/services/detail?item=SVC%2FM365');

    expect(await screen.findByText('ERPNext Disabled')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Microsoft 365' })).toBeInTheDocument();
  });

  it('says nothing was selected when the link carries no Item', () => {
    show('/msp/services/detail');

    expect(screen.getByText('No service was selected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to services' })).toBeInTheDocument();
  });

  it('tells a real 404 from anything else', async () => {
    vi.mocked(internal.getService).mockRejectedValue(
      new FrappeError('This Item no longer exists in ERPNext.', 404, 'NOT_FOUND')
    );
    show('/msp/services/detail?item=GONE');

    expect(await screen.findByText('This Item no longer exists in ERPNext.')).toBeInTheDocument();
    expect(screen.getByText('Item: GONE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('never calls a server failure a missing service', async () => {
    vi.mocked(internal.getService).mockRejectedValue(
      new FrappeError('Internal Server Error', 500, undefined)
    );
    show('/msp/services/detail?item=SVC%2FM365');

    expect(await screen.findByText('The service could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Internal Server Error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
  });

  it('never calls an empty answer a missing service', async () => {
    vi.mocked(internal.getService).mockResolvedValue(null as never);
    show('/msp/services/detail?item=SVC%2FM365');

    expect(
      await screen.findByText('The service could not be loaded because the server returned no data.')
    ).toBeInTheDocument();
  });

  it('says when the answer came back incomplete', async () => {
    vi.mocked(internal.getService).mockResolvedValue({ customers: [] } as never);
    show('/msp/services/detail?item=SVC%2FM365');

    expect(
      await screen.findByText(
        'The service could not be loaded because the server returned an incomplete response.'
      )
    ).toBeInTheDocument();
  });

  it('says plainly when the catalogue is not for this account', async () => {
    vi.mocked(internal.getService).mockRejectedValue(
      new FrappeError('Not allowed.', 403, 'PERMISSION_DENIED')
    );
    show('/msp/services/detail?item=SVC%2FM365');

    expect(
      await screen.findByText('You do not have permission to view the MSP service catalogue.')
    ).toBeInTheDocument();
  });
});
