import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import NotifyRecipientsModal from './NotifyRecipientsModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, getInvoiceRecipients: vi.fn() };
});

const recipients = (overrides: Record<string, unknown> = {}) => ({
  customer: 'Kakivu',
  billing_contact: {
    contact: 'Accounts Payable-Kakivu',
    full_name: 'Accounts Payable',
    email: 'pay@kakivu.test',
    refusal: null,
  },
  portal_users: [
    { user: 'marwa@kakivu.test', email: 'marwa@kakivu.test', full_name: 'Marwa Hasno' },
    { user: 'raghib@kakivu.test', email: 'raghib@kakivu.test', full_name: 'Ragheb Hareb' },
  ],
  ...overrides,
});

const confirm = vi.fn();

const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NotifyRecipientsModal
        open
        run="BR-2026-10-165"
        confirmLabel="Submit invoice"
        onCancel={() => {}}
        onConfirm={confirm}
      />
    </QueryClientProvider>
  );

beforeEach(() => {
  confirm.mockClear();
  vi.mocked(internal.getInvoiceRecipients).mockResolvedValue(recipients() as never);
});

afterEach(cleanup);

describe('choosing who is told about an invoice', () => {
  it('ticks the billing contact and nobody else to begin with', async () => {
    show();

    expect(await screen.findByText('Accounts Payable')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false, false]);
  });

  it('sends the contact alone when nothing else is ticked', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit invoice' }));

    expect(confirm).toHaveBeenCalledWith(['pay@kakivu.test']);
  });

  it('adds the portal accounts that were ticked', async () => {
    show();
    await screen.findByText('Marwa Hasno');

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit invoice' }));

    expect(confirm).toHaveBeenCalledWith(['pay@kakivu.test', 'marwa@kakivu.test']);
  });

  it('lets the contact be unticked, leaving the copies as the recipients', async () => {
    show();
    await screen.findByText('Marwa Hasno');

    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit invoice' }));

    expect(confirm).toHaveBeenCalledWith(['raghib@kakivu.test']);
  });

  it('says plainly when nobody is ticked at all', async () => {
    show();
    await screen.findByText('Accounts Payable');

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(
      screen.getByText(/Nobody is ticked, so no notice goes out/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit invoice without telling anyone' }));
    expect(confirm).toHaveBeenCalledWith([]);
  });

  it('says why nobody can be written to when no contact is named', async () => {
    vi.mocked(internal.getInvoiceRecipients).mockResolvedValue(
      recipients({
        billing_contact: {
          contact: null,
          full_name: null,
          email: null,
          refusal: 'Kakivu has no billing contact: no invoice notice was sent.',
        },
      }) as never
    );
    show();

    expect(await screen.findByText(/has no billing contact/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([false, false]);
  });

  it('offers nobody to copy when the company has no portal account', async () => {
    vi.mocked(internal.getInvoiceRecipients).mockResolvedValue(
      recipients({ portal_users: [] }) as never
    );
    show();

    expect(
      await screen.findByText('This company has no portal account to copy.')
    ).toBeInTheDocument();
  });

  it('asks the server for this run', async () => {
    show();

    await waitFor(() =>
      expect(vi.mocked(internal.getInvoiceRecipients).mock.calls[0][0]).toBe('BR-2026-10-165')
    );
  });
});
