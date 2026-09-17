import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import type { DeviceDetail as DeviceFile, UserDetail as UserFile } from '@/lib/api/internal';
import UserDetail from './UserDetail';
import DeviceDetail from './DeviceDetail';

vi.mock('@/lib/api/portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/portal')>();
  return {
    ...actual,
    getUserFile: vi.fn(),
    getDeviceFile: vi.fn(),
    getUserFileHistory: vi.fn(),
    getMyApprovalRights: vi.fn(),
  };
});

const session = { user: 'them@example.invalid', roles: ['MSP Customer Manager'], can_see_invoices: true };

vi.mock('@/shared/hooks/useSession', () => ({ useSession: () => ({ data: session }) }));

const person = {
  user: {
    name: 'CU-1',
    full_name: 'Adam Harmel',
    department: 'Vente',
    customer: 'ACME',
    email: 'adam@acme.test',
    username: 'a.harmel',
    lifecycle_status: 'Active',
    start_date: '2025-01-01',
    disabled_date: null,
  },
  summary: {
    current_devices: 1,
    active_personal_services: 1,
    active_device_services: 1,
    open_requests: 0,
    attention_count: 0,
  },
  personal_services: {
    current: [
      {
        name: 'SA-1',
        service_item: 'M365',
        service_name: 'Microsoft 365',
        assignment_scope: 'User',
        managed_device: null,
        hostname: null,
        operational_status: 'Active',
        billing_status: 'Billable',
        effective_start_date: '2025-02-01',
        effective_end_date: null,
        source_request: null,
        last_billed_on: '2026-08-31',
      },
    ],
    available: [],
    blocked: [],
    target_reason: null,
  },
  devices: [
    {
      device: {
        name: 'DEV-1',
        hostname: 'KV-ADAM',
        device_type: 'PC',
        status: 'Active',
        serial_number: 'SN-9',
      },
      holder_since: '2025-03-01',
      interfaces: [],
      services: { current: [], available: [] },
    },
  ],
  open_requests: [],
  // our own signals: the page must not pass them on
  attention: [
    {
      code: 'device_without_serial',
      severity: 'warning',
      entity_type: 'device',
      entity: 'DEV-1',
      message: 'KV-ADAM has no serial number.',
    },
  ],
  recent_activity: [],
  billing: { covered_until: '2026-07-31', last_billed_on: '2026-08-11' },
} as unknown as UserFile;

const machine = {
  device: {
    name: 'DEV-1',
    hostname: 'KV-ADAM',
    device_type: 'PC',
    status: 'Active',
    customer: 'ACME',
    assigned_client_user: 'CU-1',
    user_name: 'Adam Harmel',
    user_department: 'Vente',
    assigned_date: '2025-03-01',
    retired_date: null,
    serial_number: 'SN-9',
    asset_tag: null,
    manufacturer: 'Lenovo',
    model: 'ThinkPad T14',
    operating_system: 'Windows 11',
    last_billed_on: '2026-08-11',
    covered_until: '2026-07-31',
  },
  holder_log: [
    {
      client_user: 'CU-1',
      full_name: 'Adam Harmel',
      from_date: '2025-03-01',
      to_date: null,
      note: null,
      is_current: 1,
      idx: 1,
      lifecycle_status: 'Active',
      disabled_date: null,
    },
  ],
  interfaces: [{ interface_type: 'Wi-Fi', mac_address: 'AA-BB-CC-DD-EE-FF' }],
  services: [
    {
      name: 'SA-2',
      service_item: 'SOPHOS',
      service_name: 'Sophos',
      assignment_scope: 'Device',
      managed_device: 'DEV-1',
      hostname: 'KV-ADAM',
      operational_status: 'Active',
      billing_status: 'Billable',
      effective_start_date: '2025-04-01',
      effective_end_date: null,
      source_request: null,
      last_billed_on: null,
    },
  ],
  requests: [],
} as unknown as DeviceFile;

const show = async (element: React.ReactNode, path: string, route: string) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.mocked(portal.getUserFile).mockResolvedValue(person);
  vi.mocked(portal.getDeviceFile).mockResolvedValue(machine);
  vi.mocked(portal.getUserFileHistory).mockResolvedValue({} as never);
  vi.mocked(portal.getMyApprovalRights).mockResolvedValue({ can_submit: true } as never);
});

afterEach(cleanup);

describe('the person file a customer reads', () => {
  it('is the same page, with the facts and nothing to act with', async () => {
    await show(<UserDetail portal />, '/msp/users/:name', '/msp/users/CU-1');

    expect(await screen.findByText('Adam Harmel')).toBeInTheDocument();
    expect(screen.getByText('Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('KV-ADAM')).toBeInTheDocument();
    expect(screen.getByText('Billing & coverage')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^disable$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add service/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign a device/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Internal notes')).not.toBeInTheDocument();
    expect(screen.queryByText(/has no serial number/i)).not.toBeInTheDocument();
  });

  it('offers only the way to raise a request, and the machine it holds', async () => {
    await show(<UserDetail portal />, '/msp/users/:name', '/msp/users/CU-1');

    expect(await screen.findByRole('button', { name: /raise a request/i })).toBeInTheDocument();

    const menus = screen.getAllByTitle('More options');
    expect(menus).toHaveLength(1);
  });
});

describe('the machine file a customer reads', () => {
  it('shows what the machine is, who holds it and what runs on it', async () => {
    await show(<DeviceDetail portal />, '/msp/devices/:name', '/msp/devices/DEV-1');

    expect(await screen.findByRole('heading', { name: 'KV-ADAM' })).toBeInTheDocument();
    expect(screen.getByText('ThinkPad T14')).toBeInTheDocument();
    expect(screen.getByText('Windows 11')).toBeInTheDocument();
    expect(screen.getByText('Sophos')).toBeInTheDocument();
    expect(screen.getByText('AA-BB-CC-DD-EE-FF')).toBeInTheDocument();
    // who has held it, and since when
    expect(screen.getByText('Who has held it')).toBeInTheDocument();
    expect(screen.getAllByText('Adam Harmel').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2025-03-01').length).toBeGreaterThan(0);
  });

  it('carries no action at all, and none of our notes', async () => {
    await show(<DeviceDetail portal />, '/msp/devices/:name', '/msp/devices/DEV-1');

    expect(await screen.findByRole('heading', { name: 'KV-ADAM' })).toBeInTheDocument();
    // a request is about a person: it is raised from whoever holds the machine
    expect(screen.queryByRole('button', { name: /raise a request/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Adam Harmel' }).length).toBeGreaterThan(0);

    for (const label of [/edit device/i, /assign to user/i, /^transfer$/i, /return to stock/i, /^retire$/i, /^delete$/i, /add service/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Remarks')).not.toBeInTheDocument();
    expect(screen.queryByTitle('More options')).not.toBeInTheDocument();
  });
});

describe('a contact kept away from invoices', () => {
  it('reads the file without the billing dates', async () => {
    session.can_see_invoices = false;

    await show(<UserDetail portal />, '/msp/users/:name', '/msp/users/CU-1');

    expect(await screen.findByText('Adam Harmel')).toBeInTheDocument();
    expect(screen.queryByText('Billing & coverage')).not.toBeInTheDocument();

    cleanup();
    await show(<DeviceDetail portal />, '/msp/devices/:name', '/msp/devices/DEV-1');

    expect(await screen.findByRole('heading', { name: 'KV-ADAM' })).toBeInTheDocument();
    expect(screen.queryByText('Billed up to')).not.toBeInTheDocument();
    session.can_see_invoices = true;
  });
});
