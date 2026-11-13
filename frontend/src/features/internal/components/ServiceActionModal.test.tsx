import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { UserServiceRow } from '@/lib/api/internal';
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

const open = (
  action: 'End' | 'Suspend' | 'Change',
  overrides: Partial<UserServiceRow> = {},
  requestedDate?: string | null
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <ServiceActionModal
        clientUser="CU-1"
        target={{ row: row(overrides), action }}
        requests={[]}
        requestedDate={requestedDate}
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

  it('sends the stop once confirmed', async () => {
    vi.mocked(internal.changeUserService).mockResolvedValue({} as never);
    const dialog = open('End');

    fireEvent.change(within(dialog).getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), {
      target: { value: '2026-03-15' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /stop service/i }));

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

describe('a period already invoiced is information, not a wall', () => {
  it('submits the action once without asking for confirmation', async () => {
    vi.mocked(internal.changeUserService).mockResolvedValue({} as never);
    const dialog = open('Suspend');

    fireEvent.click(within(dialog).getByRole('button', { name: /^suspend$/i }));

    await waitFor(() => expect(internal.changeUserService).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.changeUserService).mock.calls[0][0]).toMatchObject({
      action: 'Suspend',
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

describe('carrying out a request that asked for a day', () => {
  /**
   * We are often days behind the customer. The form opened on today whatever the request
   * said, so a service asked to stop on the 10th stopped on the 12th — and the customer
   * was billed for the two days we took to get to it.
   */
  it('opens on the day the request asked for, not today', () => {
    const dialog = open('End', {}, '2026-11-10');

    expect(within(dialog).getByDisplayValue('2026-11-10')).toBeInTheDocument();
    expect(within(dialog).getByText('The date this request asked for (2026-11-10).')).toBeInTheDocument();
  });

  it('sends that day, not the day the work was done', async () => {
    const dialog = open('End', {}, '2026-11-10');
    vi.mocked(internal.changeUserService).mockResolvedValue({} as never);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop service' }));

    await waitFor(() =>
      expect(vi.mocked(internal.changeUserService).mock.calls[0][0]).toMatchObject({
        action: 'End',
        effective_date: '2026-11-10',
      })
    );
  });

  it('says so when somebody moves it off that day', () => {
    const dialog = open('End', {}, '2026-11-10');

    fireEvent.change(within(dialog).getByDisplayValue('2026-11-10'), {
      target: { value: '2026-11-12' },
    });

    expect(
      within(dialog).getByText('The request asked for 2026-11-10. Say why in the note below.')
    ).toBeInTheDocument();
  });

  it('will not move it off that day without a reason', () => {
    const dialog = open('End', {}, '2026-11-10');

    fireEvent.change(within(dialog).getByDisplayValue('2026-11-10'), {
      target: { value: '2026-11-12' },
    });

    expect(within(dialog).getByRole('button', { name: 'Stop service' })).toBeDisabled();

    fireEvent.change(within(dialog).getByPlaceholderText(/Why is this service being stopped/), {
      target: { value: 'Contractual notice runs to the 12th' },
    });

    expect(within(dialog).getByRole('button', { name: 'Stop service' })).toBeEnabled();
  });

  it('opens on today when no request asked for a day', () => {
    const dialog = open('End');

    expect(within(dialog).queryByText(/this request asked for/)).not.toBeInTheDocument();
  });
});
