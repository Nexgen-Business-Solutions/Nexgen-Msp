import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import CustomerModal from './CustomerModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return { ...actual, createCustomer: vi.fn(), getCustomerOptions: vi.fn() };
});

const onCreated = vi.fn();

const open = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <CustomerModal open customer="" details={null} onClose={() => undefined} onCreated={onCreated} />
    </QueryClientProvider>
  );

  return screen.getByRole('dialog');
};

const nameField = (dialog: HTMLElement) =>
  within(dialog).getByText('Name').parentElement?.querySelector('input') as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('putting a new customer on file', () => {
  it('offers every detail of the customer form, and needs a name first', () => {
    const dialog = open();

    for (const label of ['Type', 'Group', 'Territory', 'Tax ID', 'Website', 'City', 'Country', 'Payment terms']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('button', { name: /create customer/i })).toBeDisabled();
  });

  it('creates it with its details and hands back the new name', async () => {
    vi.mocked(internal.createCustomer).mockResolvedValue({ name: 'Acme Ltd' } as never);
    const dialog = open();

    fireEvent.change(nameField(dialog), { target: { value: ' Acme Ltd ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /create customer/i }));

    await waitFor(() =>
      expect(vi.mocked(internal.createCustomer).mock.calls[0][0]).toMatchObject({
        customer_name: 'Acme Ltd',
        details: { customer_type: 'Company' },
      })
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Acme Ltd'));
  });

  it('says why ERPNext refused it', async () => {
    vi.mocked(internal.createCustomer).mockRejectedValue(new Error('Customer Acme Ltd already exists.'));
    const dialog = open();

    fireEvent.change(nameField(dialog), { target: { value: 'Acme Ltd' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /create customer/i }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
  });
});
