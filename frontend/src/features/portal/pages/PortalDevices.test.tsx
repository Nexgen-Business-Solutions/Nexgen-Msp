import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import PortalDevices from './PortalDevices';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return {
    ...actual,
    listDevices: vi.fn(),
    getSummary: vi.fn(),
    getPortalFilterOptions: vi.fn(),
    listSubscribedServices: vi.fn(),
    getMyApprovalRights: vi.fn(),
  };
});

const machine = {
  name: 'DEV-1',
  hostname: 'KV-ABBASS',
  device_type: 'PC',
  status: 'Active',
  assigned_client_user: null,
  assigned_date: null,
  retired_date: null,
  serial_number: 'SN-42',
  manufacturer: null,
  model: null,
  operating_system: null,
  customer: 'ACME',
  assigned_user_name: null,
  active_services: 1,
  inactive_services: 0,
  services: 'Sophos',
  interfaces: [],
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(portal.listDevices).mockResolvedValue({
    rows: [machine],
    start: 0,
    page_length: 20,
    total: 1,
    has_more: false,
  } as never);
  vi.mocked(portal.getSummary).mockResolvedValue({} as never);
  vi.mocked(portal.getPortalFilterOptions).mockResolvedValue({ statuses: [], services: [] } as never);
  vi.mocked(portal.listSubscribedServices).mockResolvedValue([] as never);
  vi.mocked(portal.getMyApprovalRights).mockResolvedValue({ can_submit: true } as never);
});

afterEach(cleanup);

const renderList = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/msp/devices']}>
        <Routes>
          <Route path="/msp/devices" element={<PortalDevices />} />
          <Route path="/msp/devices/:name" element={<p>the machine file</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('KV-ABBASS');
};

describe('raising a request about a machine', () => {
  it('is offered for whoever holds it, and not at all when nobody does', async () => {
    await renderList();

    fireEvent.click(screen.getByTitle('More options'));
    expect(screen.queryByRole('button', { name: /raise a request/i })).not.toBeInTheDocument();

    cleanup();
    vi.mocked(portal.listDevices).mockResolvedValue({
      rows: [{ ...machine, assigned_client_user: 'CU-1', assigned_user_name: 'Adam Harmel' }],
      start: 0,
      page_length: 20,
      total: 1,
      has_more: false,
    } as never);
    await renderList();

    fireEvent.click(screen.getByTitle('More options'));
    expect(
      await screen.findByRole('button', { name: 'Raise a request for Adam Harmel' })
    ).toBeInTheDocument();
  });
});

describe('a customer opening one of their machines', () => {
  it('opens its file from the hostname', async () => {
    await renderList();

    fireEvent.click(screen.getByRole('button', { name: 'KV-ABBASS' }));

    expect(await screen.findByText('the machine file')).toBeInTheDocument();
  });

  it('opens it from the row menu too', async () => {
    await renderList();

    fireEvent.click(screen.getByTitle('More options'));
    fireEvent.click(await screen.findByRole('button', { name: /open device/i }));

    expect(await screen.findByText('the machine file')).toBeInTheDocument();
  });
});
