import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { UserServiceRow } from '@/lib/api/internal';
import { FrappeError } from '@/lib/api/client';
import ServiceActionModal from './ServiceActionModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, changeUserService: vi.fn(), userServiceAvailability: vi.fn() };
});

const row = (overrides: Partial<UserServiceRow> = {}): UserServiceRow => ({
  name: 'SA-1',
  service_item: 'M365',
  service_name: 'Microsoft 365',
  assignment_scope: 'User',
  managed_device: null,
  hostname: null,
  operational_status: 'Active',
  billing_status: 'Billable',
  effective_start_date: '2026-01-01',
  effective_end_date: null,
  source_request: null,
  last_billed_on: '2026-03-31',
  ...overrides,
});

const open = (action: 'End' | 'Suspend' | 'Change', overrides: Partial<UserServiceRow> = {}) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <ServiceActionModal
        clientUser="CU-1"
        target={{ row: row(overrides), action }}
        requests={[]}
        onClose={() => undefined}
      />
    </QueryClientProvider>
  );

  return screen.getByRole('dialog');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('closing a service already invoiced', () => {
  it('says how far it was invoiced, and that closing behind it is accepted', async () => {
    const dialog = open('End');

    fireEvent.change(within(dialog).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), {
      target: { value: '2026-03-15' },
    });

    expect(within(dialog).getByText(/invoiced up to 2026-03-31/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/is accepted/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/no credit note is created/i)).toBeInTheDocument();
  });

  it('sends the close once confirmed', async () => {
    vi.mocked(internal.changeUserService).mockResolvedValue({} as never);
    const dialog = open('End');

    fireEvent.change(within(dialog).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), {
      target: { value: '2026-03-15' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /close service/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.changeUserService).mock.calls[0][0]).toMatchObject({
        assignment: 'SA-1',
        action: 'End',
        effective_date: '2026-03-15',
      })
    );
  });

  it('says nothing about invoices for a service never billed', () => {
    const dialog = open('End', { last_billed_on: null });

    expect(within(dialog).queryByText(/invoiced up to/i)).not.toBeInTheDocument();
  });

  it('keeps it to closing: a pause is not told it may cross an invoice', () => {
    const dialog = open('Suspend');

    expect(within(dialog).queryByText(/invoiced up to/i)).not.toBeInTheDocument();
  });
});

describe('a period already invoiced is a warning, not a wall', () => {
  it('asks to confirm, then goes ahead with the confirmation', async () => {
    vi.mocked(internal.changeUserService)
      .mockRejectedValueOnce(
        new FrappeError(
          'This service is invoiced up to 24-11-2026. This period has already been invoiced. Confirm to go ahead anyway: the invoice already issued stays as it is.',
          400,
          'BILLED_PERIOD'
        )
      )
      .mockResolvedValueOnce({} as never);
    const dialog = open('Suspend');

    fireEvent.click(within(dialog).getByRole('button', { name: /^suspend$/i }));

    expect(await screen.findByText(/this period is already invoiced/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /go ahead/i }));

    await waitFor(() => expect(internal.changeUserService).toHaveBeenCalledTimes(2));
    expect(vi.mocked(internal.changeUserService).mock.calls[1][0]).toMatchObject({
      action: 'Suspend',
      confirm_billed: 1,
    });
  });
});

describe('changing a service directly', () => {
  it('moves it onto another available service, with nothing about quantity', async () => {
    vi.mocked(internal.userServiceAvailability).mockResolvedValue({
      target: { scope: 'User', name: 'CU-1', label: 'John', customer: 'ACME' },
      is_admin: true,
      target_reason: null,
      current: [],
      available: [{ service_item: 'M365-E5', item_name: 'Microsoft 365 E5', service_scope: 'User' }],
      blocked: [],
    } as never);
    vi.mocked(internal.changeUserService).mockResolvedValue({} as never);
    const dialog = open('Change');

    expect(within(dialog).queryByText(/quantity/i)).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: /change service/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /select the service that replaces it/i }));
    fireEvent.click(await screen.findByRole('option', { name: /microsoft 365 e5/i }));
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(vi.mocked(internal.changeUserService).mock.calls[0][0]).toMatchObject({
        assignment: 'SA-1',
        action: 'Change',
        service_item: 'M365-E5',
      })
    );
  });
});
