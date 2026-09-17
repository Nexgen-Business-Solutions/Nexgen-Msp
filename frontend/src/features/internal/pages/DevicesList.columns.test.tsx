import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import DevicesList from './DevicesList';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    listManagedDevices: vi.fn(),
    getDeviceStats: vi.fn(),
    getDeviceFilterOptions: vi.fn(),
    createManagedDevice: vi.fn(),
    listCustomerUsers: vi.fn(),
    listCustomerRequests: vi.fn(),
    findDeviceHostname: vi.fn(),
    findDeviceSerial: vi.fn(),
  };
});

const row = (overrides: Partial<internal.DeviceRow> = {}): internal.DeviceRow => ({
  name: 'DEV-1',
  hostname: 'KV-ABBASS',
  device_type: 'PC',
  status: 'Stock',
  assigned_date: null,
  serial_number: 'SN-42',
  customer: 'ACME',
  assigned_client_user: null,
  user_name: null,
  user_department: null,
  user_status: null,
  active_services: 1,
  inactive_services: 0,
  has_services: 1,
  interfaces: [],
  ...overrides,
});

const renderList = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DevicesList />
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('KV-ABBASS');
};

const headers = () =>
  screen
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent?.trim())
    .filter(Boolean);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(internal.listManagedDevices).mockResolvedValue({
    rows: [row()],
    start: 0,
    page_length: 20,
    total: 1,
    has_more: false,
  } as never);
  vi.mocked(internal.getDeviceStats).mockResolvedValue({} as never);
  vi.mocked(internal.createManagedDevice).mockResolvedValue({ name: 'DEV-2', hostname: 'NEW-PC', customer: 'ACME' });
  vi.mocked(internal.listCustomerUsers).mockResolvedValue([
    { name: 'CU-1', full_name: 'Jane Doe', department: 'Sales' },
  ] as never);
  vi.mocked(internal.listCustomerRequests).mockResolvedValue([]);
  vi.mocked(internal.findDeviceHostname).mockResolvedValue(null as never);
  vi.mocked(internal.findDeviceSerial).mockResolvedValue(null as never);
  vi.mocked(internal.getDeviceFilterOptions).mockResolvedValue({
    customers: ['ACME'],
    statuses: [],
    device_types: [],
    interface_types: [],
  } as never);
});

afterEach(cleanup);

describe('the columns the device list shows', () => {
  it('keeps the hostname and the serial together, and gives the rest their own columns', async () => {
    await renderList();

    expect(headers()).toEqual(['Device', 'Type', 'Customer', 'Held by', 'Status', 'Active services']);

    const device = screen.getByText('KV-ABBASS').closest('td') as HTMLElement;
    expect(within(device).getByText('SN-42')).toBeInTheDocument();
    expect(within(device).queryByText('Unassigned')).not.toBeInTheDocument();
    expect(within(device).queryByText('PC')).not.toBeInTheDocument();
  });

  it('shows where the machine stands as a badge', async () => {
    await renderList();

    expect(screen.getByText('STOCK')).toBeInTheDocument();
  });

  it('lets no more than six columns be picked, and shows the ones applied', async () => {
    await renderList();

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('6 of 6 selected')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Model' })).toBeDisabled();
    expect(within(dialog).queryByRole('group', { name: 'Per service' })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Customer' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Model' }));
    expect(within(dialog).getByText('6 of 6 selected')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByRole('columnheader', { name: 'Model' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Customer' })).not.toBeInTheDocument();
  });
});

describe('a new device from the list', () => {
  it('picks the customer first, then registers the machine with what its case says', async () => {
    await renderList();

    fireEvent.click(screen.getByRole('button', { name: /^new device$/i }));
    const dialog = screen.getByRole('dialog');
    const add = within(dialog).getByRole('button', { name: /^add device$/i });

    // nothing on the existing-machine side: nobody is named yet to hand one to
    expect(within(dialog).queryByRole('button', { name: /existing device/i })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText('SN-HYS-JDUPONT'), { target: { value: 'NEW-PC' } });
    fireEvent.change(within(dialog).getByPlaceholderText('What is engraved on the case'), {
      target: { value: 'SN-NEW' },
    });
    expect(add).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /select a customer/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'ACME' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^nobody$/i }));
    fireEvent.click(await screen.findByRole('option', { name: /jane doe/i }));

    fireEvent.change(within(dialog).getByLabelText('Manufacturer'), { target: { value: 'Lenovo' } });
    fireEvent.change(within(dialog).getByLabelText('Model'), { target: { value: 'ThinkPad T14' } });
    fireEvent.change(within(dialog).getByLabelText('Operating system'), { target: { value: 'Windows 11' } });

    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);

    await waitFor(() =>
      expect(vi.mocked(internal.createManagedDevice).mock.calls[0][0]).toMatchObject({
        customer: 'ACME',
        assigned_client_user: 'CU-1',
        hostname: 'NEW-PC',
        serial_number: 'SN-NEW',
        manufacturer: 'Lenovo',
        model: 'ThinkPad T14',
        operating_system: 'Windows 11',
      })
    );
  });
});

