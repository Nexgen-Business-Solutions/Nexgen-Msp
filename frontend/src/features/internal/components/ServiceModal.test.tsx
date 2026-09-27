import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { ItemMspCompatibility } from '@/lib/api/internal';
import { FrappeError } from '@/lib/api/client';
import ServiceModal from './ServiceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    searchCatalogueItems: vi.fn(),
    getItemMspCompatibility: vi.fn(),
    enableItemForMsp: vi.fn(),
    createMspService: vi.fn(),
  };
});

const item = (overrides: Record<string, unknown> = {}) => ({
  name: 'LEGACY-01',
  item_name: 'Legacy licence',
  item_group: 'Services',
  disabled: 1,
  is_stock_item: 0,
  is_sales_item: 1,
  stock_uom: 'Unit',
  sales_uom: 'Unit',
  msp_service_enabled: 0,
  scope: null,
  month_ready: false,
  ...overrides,
});

const compatibility = (overrides: Partial<ItemMspCompatibility> = {}): ItemMspCompatibility => ({
  item: {
    name: 'LEGACY-01',
    item_name: 'Legacy licence',
    description: 'What the customer receives.',
    item_group: 'Services',
    disabled: 1,
    is_stock_item: 0,
    is_sales_item: 1,
    stock_uom: 'Unit',
    sales_uom: 'Unit',
  },
  msp: { definition: null, in_msp: false, enabled: false, scope: null, invoice_label: null },
  billing: { required_uom: 'Month', has_required_uom: false, conversion_factor: null },
  compatibility_status: 'ERPNext Disabled',
  fingerprint: { disabled: 1, is_stock_item: 0, is_sales_item: 1, month_conversion_factor: null },
  blockers: ['ITEM_DISABLED', 'MSP_BILLING_UOM_MISSING'],
  repairs: [
    {
      code: 'ITEM_DISABLED',
      field: 'enable_item',
      label: 'Enable this Item in ERPNext',
      message: 'This Item is disabled globally in ERPNext. It must be enabled before it can be available in MSP.',
    },
    {
      code: 'MSP_BILLING_UOM_MISSING',
      field: 'add_month_uom',
      label: 'Add Month as an Item UOM with conversion factor 1',
      message: 'Month is not configured for this Item.',
    },
  ],
  warnings: [],
  can_enable_in_place: true,
  ...overrides,
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServiceModal open onClose={() => {}} />
    </QueryClientProvider>
  );

const pickScope = async (value: string) => {
  fireEvent.click(screen.getByRole('button', { name: /select a scope/i }));
  const options = await screen.findAllByRole('option');
  const wanted = options.find((option) => option.textContent?.startsWith(value));
  fireEvent.click(wanted as HTMLElement);
};

beforeEach(() => {
  vi.mocked(internal.searchCatalogueItems).mockResolvedValue({
    rows: [item(), item({ name: 'STOCK-01', item_name: 'A boxed thing', is_stock_item: 1, disabled: 0 })],
    total: 2,
    start: 0,
    page_length: 20,
  } as never);
  vi.mocked(internal.getItemMspCompatibility).mockResolvedValue(compatibility());
  vi.mocked(internal.enableItemForMsp).mockResolvedValue({
    name: 'LEGACY-01',
    item_name: 'Legacy licence',
    definition: 'MSP-SVC-00009',
    scope: 'User',
    erpnext_enabled: true,
  });
  vi.mocked(internal.createMspService).mockResolvedValue({
    name: 'SVC-NEW',
    item_name: 'Brand new',
    definition: 'MSP-SVC-00010',
    scope: 'User',
  });
});

afterEach(cleanup);

describe('adding a service', () => {
  it('asks first whether the Item already exists', () => {
    show();

    expect(screen.getByText('Connect an existing ERPNext Item to Nexgen MSP or create a new service Item.')).toBeInTheDocument();
    expect(screen.getByText('Use existing Item')).toBeInTheDocument();
    expect(screen.getByText('Create new Item')).toBeInTheDocument();
    expect(screen.queryByLabelText('Service code')).not.toBeInTheDocument();
  });

  it('finds Items the site disabled, and says what they are', async () => {
    show();

    fireEvent.click(screen.getByText('Use existing Item'));
    const row = (await screen.findByText('Legacy licence')).closest('button') as HTMLElement;

    expect(within(row).getByText('Disabled')).toBeInTheDocument();
    expect(within(row).getByText('Not in MSP')).toBeInTheDocument();
    expect(within(row).getByText('Month missing')).toBeInTheDocument();
    expect(within(row).getByText('Stock UOM: Unit · Sales UOM: Unit')).toBeInTheDocument();
  });

  it('refuses to convert a stock Item in place, and offers a new one instead', async () => {
    vi.mocked(internal.getItemMspCompatibility).mockResolvedValue(
      compatibility({
        item: { ...compatibility().item, name: 'STOCK-01', item_name: 'A boxed thing', is_stock_item: 1, disabled: 0 },
        blockers: ['MSP_STOCK_ITEM'],
        repairs: [],
        can_enable_in_place: false,
      })
    );
    show();

    fireEvent.click(screen.getByText('Use existing Item'));
    fireEvent.click(await screen.findByText('A boxed thing'));

    expect(await screen.findByText('This Item is a stock item')).toBeInTheDocument();
    expect(
      screen.getByText(
        'MSP services must use non-stock Items. Nexgen MSP will not change an existing stock Item because doing so can affect inventory history.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create a service Item from this' }));

    expect(await screen.findByText('Create new MSP service')).toBeInTheDocument();
    expect(screen.getByText('Based on ERPNext Item: STOCK-01')).toBeInTheDocument();
    expect(screen.getByLabelText('Service code')).toHaveValue('');
  });

  it('names every change before it is made, and sends only what was agreed to', async () => {
    show();

    fireEvent.click(screen.getByText('Use existing Item'));
    fireEvent.click(await screen.findByText('Legacy licence'));

    const adopt = await screen.findByRole('button', { name: /apply changes & add to msp/i });
    expect(adopt).toBeDisabled();

    expect(screen.getByText('This Item is disabled globally in ERPNext. It must be enabled before it can be available in MSP.')).toBeInTheDocument();
    expect(screen.getByText('Month is not configured for this Item.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /enable this item in erpnext/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /add month as an item uom/i }));
    await pickScope('User');

    await waitFor(() => expect(adopt).toBeEnabled());
    fireEvent.click(adopt);

    await waitFor(() =>
      expect(vi.mocked(internal.enableItemForMsp).mock.calls[0][0]).toMatchObject({
        item: 'LEGACY-01',
        scope: 'User',
        enable_item: 1,
        add_month_uom: 1,
        allow_sales: 0,
        fix_month_factor: 0,
      })
    );
  });

  it('repairs a wrong Month factor only when that is ticked', async () => {
    vi.mocked(internal.getItemMspCompatibility).mockResolvedValue(
      compatibility({
        item: { ...compatibility().item, disabled: 0 },
        billing: { required_uom: 'Month', has_required_uom: true, conversion_factor: 30 },
        blockers: ['MSP_BILLING_UOM_MISSING'],
        repairs: [
          {
            code: 'MSP_BILLING_UOM_MISSING',
            field: 'fix_month_factor',
            label: 'Set the Month conversion factor to 1',
            message:
              'Month currently uses conversion factor 30. MSP billing requires conversion factor 1.',
          },
        ],
      })
    );
    show();

    fireEvent.click(screen.getByText('Use existing Item'));
    fireEvent.click(await screen.findByText('Legacy licence'));

    expect(
      await screen.findByText(
        'Month currently uses conversion factor 30. MSP billing requires conversion factor 1.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /set the month conversion factor to 1/i }));
    await pickScope('Device');
    fireEvent.click(screen.getByRole('button', { name: /apply changes & add to msp/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.enableItemForMsp).mock.calls[0][0]).toMatchObject({
        fix_month_factor: 1,
        scope: 'Device',
      })
    );
  });

  it('says plainly when a new code is already taken', async () => {
    vi.mocked(internal.createMspService).mockRejectedValue(
      new FrappeError(
        'An Item with code "SVC-M365" already exists. Choose "Use existing Item" instead.',
        400,
        'ITEM_CODE_EXISTS'
      )
    );
    show();

    fireEvent.click(screen.getByText('Create new Item'));
    fireEvent.change(screen.getByLabelText('Service code'), { target: { value: 'SVC-M365' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Microsoft 365' } });
    await pickScope('User');
    fireEvent.click(screen.getByRole('button', { name: /create service/i }));

    expect(
      await screen.findByText('An Item with code "SVC-M365" already exists. Choose "Use existing Item" instead.')
    ).toBeInTheDocument();
  });
});
