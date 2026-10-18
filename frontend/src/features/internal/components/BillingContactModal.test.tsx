import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import BillingContactModal from './BillingContactModal';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    listCustomerContacts: vi.fn(),
    setCustomerBillingContact: vi.fn(),
    addCustomerBillingContact: vi.fn(),
  };
});

const contact = (overrides: Record<string, unknown> = {}) => ({
  name: 'CT-1',
  first_name: 'Marie',
  last_name: 'Dupont',
  label: 'Marie Dupont',
  email: 'marie@acme.test',
  user: null,
  has_account: false,
  ...overrides,
});

const show = (rows: ReturnType<typeof contact>[], current: string | null = null) => {
  vi.mocked(internal.listCustomerContacts).mockResolvedValue(rows as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BillingContactModal open customer="ACME" current={current} onClose={() => {}} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.mocked(internal.setCustomerBillingContact).mockResolvedValue({} as never);
  vi.mocked(internal.addCustomerBillingContact).mockResolvedValue({} as never);
});

afterEach(cleanup);

describe('naming who the invoices are announced to', () => {
  it('offers the contacts this company already has, accounts marked as such', async () => {
    show([contact(), contact({ name: 'CT-2', label: 'Paul Admin', email: 'paul@acme.test', has_account: true, user: 'paul@acme.test' })]);

    expect(await screen.findByText('Marie Dupont')).toBeInTheDocument();
    expect(screen.getByText(/marie@acme.test/)).toBeInTheDocument();
    expect(screen.getByText(/has an account here/)).toBeInTheDocument();
  });

  it('names the one that was chosen', async () => {
    show([contact()]);

    fireEvent.click(await screen.findByText('Marie Dupont'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(vi.mocked(internal.setCustomerBillingContact).mock.calls[0][0]).toEqual({
        customer: 'ACME',
        contact: 'CT-1',
      })
    );
  });

  it('lets a company have nobody, and says what that means', async () => {
    show([contact()], 'CT-1');

    const none = await screen.findByText(/no invoice notice is sent for this company/);
    fireEvent.click(none);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(vi.mocked(internal.setCustomerBillingContact).mock.calls[0][0]).toEqual({
        customer: 'ACME',
        contact: null,
      })
    );
  });

  it('adds an accountant who has no account at all', async () => {
    show([]);

    fireEvent.click(await screen.findByRole('button', { name: /Add somebody who has no account/ }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Accounts Payable' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pay@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(vi.mocked(internal.addCustomerBillingContact).mock.calls[0][0]).toEqual({
        customer: 'ACME',
        full_name: 'Accounts Payable',
        email: 'pay@acme.test',
      })
    );
  });

  it('says plainly that naming them grants no access', async () => {
    show([]);

    fireEvent.click(await screen.findByRole('button', { name: /Add somebody who has no account/ }));

    expect(
      screen.getByText(/naming them does not grant any access to the portal/)
    ).toBeInTheDocument();
  });

  it('refuses to save an address that is not one', async () => {
    show([]);

    fireEvent.click(await screen.findByRole('button', { name: /Add somebody who has no account/ }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'No Address' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
