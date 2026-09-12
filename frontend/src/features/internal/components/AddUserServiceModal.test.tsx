import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { ServiceAvailability, UserDetail } from '@/lib/api/internal';
import AddUserServiceModal from './AddUserServiceModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    userServiceAvailability: vi.fn(),
    assignUserService: vi.fn(),
  };
});

const user: UserDetail['user'] = {
  name: 'USR-001',
  full_name: 'John Doe',
  department: 'Accounting',
  customer: 'CUST-001',
  email: 'john@company.com',
  username: 'jdoe',
  lifecycle_status: 'Active',
  start_date: '2024-01-01',
  disabled_date: null,
};

const availability = (overrides: Partial<ServiceAvailability> = {}): ServiceAvailability => ({
  target: { scope: 'User', name: user.name, label: user.full_name, customer: user.customer },
  is_admin: false,
  target_reason: null,
  current: [],
  available: [],
  blocked: [],
  ...overrides,
});

const renderModal = async (
  data: ServiceAvailability,
  overrides: Partial<ComponentProps<typeof AddUserServiceModal>> = {}
) => {
  vi.mocked(internal.userServiceAvailability).mockResolvedValue(data);
  vi.mocked(internal.assignUserService).mockResolvedValue(
    {} as unknown as Awaited<ReturnType<typeof internal.assignUserService>>
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const rendered = render(
    <QueryClientProvider client={client}>
      <AddUserServiceModal open user={user} requests={[]} onClose={vi.fn()} {...overrides} />
    </QueryClientProvider>
  );

  await screen.findByText('John Doe');
  return rendered;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddUserServiceModal', () => {
  it('offers exactly what the availability endpoint says is available', async () => {
    await renderModal(
      availability({
        available: [
          { service_item: 'ITEM-M365', item_name: 'Microsoft 365', service_scope: 'User' },
          { service_item: 'ITEM-VPN', item_name: 'VPN', service_scope: 'Both' },
        ],
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: /select a service/i }));

    expect(await screen.findByRole('option', { name: /microsoft 365/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /vpn/i })).toBeInTheDocument();
  });

  it('says the person already holds everything when nothing is left to offer', async () => {
    await renderModal(availability());

    expect(
      await screen.findByText('John Doe already has every service currently available.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select a service/i })).not.toBeInTheDocument();
  });

  it('shows why the person themselves is out of reach instead of a service list', async () => {
    await renderModal(
      availability({
        target_reason: 'John Doe is disabled and cannot be given a new service.',
        available: [
          { service_item: 'ITEM-M365', item_name: 'Microsoft 365', service_scope: 'User' },
        ],
      })
    );

    expect(
      await screen.findByText('John Doe is disabled and cannot be given a new service.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select a service/i })).not.toBeInTheDocument();
  });

  it('activates the chosen service on this person, with no device field in sight', async () => {
    await renderModal(
      availability({
        available: [
          { service_item: 'ITEM-M365', item_name: 'Microsoft 365', service_scope: 'User' },
        ],
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: /select a service/i }));
    fireEvent.click(await screen.findByRole('option', { name: /microsoft 365/i }));
    fireEvent.click(screen.getByRole('button', { name: /activate service/i }));

    await waitFor(() => expect(internal.assignUserService).toHaveBeenCalledTimes(1));
    expect(internal.assignUserService).toHaveBeenCalledWith({
      client_user: 'USR-001',
      service_item: 'ITEM-M365',
      effective_date: new Date().toISOString().slice(0, 10),
      notes: undefined,
      source_request: undefined,
    });
  });
});
