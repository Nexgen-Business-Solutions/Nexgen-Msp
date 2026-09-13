import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import type { CustomerDetails } from '@/lib/api/internal';
import Customer360 from './Customer360';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getCustomerDetails: vi.fn(),
    getCustomerOptions: vi.fn(),
    saveCustomerDetails: vi.fn(),
  };
});

const detail = (overrides: Partial<CustomerDetails> = {}): CustomerDetails =>
  ({
    name: 'ACME',
    customer_name: 'ACME Corporation',
    customer_type: 'Company',
    customer_group: 'Commercial',
    territory: 'Cameroon',
    tax_id: 'TX-1',
    default_currency: 'XAF',
    default_price_list: 'Standard Selling',
    payment_terms: '30 days',
    website: 'https://acme.example',
    msp_free_of_charge: 0,
    last_billed_on: null,
    address: {
      name: 'ADDR-1',
      address_line1: '1 High Street',
      address_line2: null,
      city: 'Douala',
      state: null,
      pincode: null,
      country: 'Cameroon',
      phone: null,
      email_id: null,
    },
    contact: {
      name: 'CONT-1',
      first_name: 'Marie',
      last_name: 'Dupont',
      email_id: 'marie@acme.example',
      phone: '+237000000',
      shared: false,
    },
    counts: { users: 126, devices: 83, contracts: 2 },
    can: {
      edit_commercial: true,
      edit_profile: true,
      manage_contracts: true,
      manage_pricing: true,
    },
    shared: { address: false },
    ...overrides,
  }) as unknown as CustomerDetails;

const renderPage = async (data: CustomerDetails) => {
  vi.mocked(internal.getCustomerDetails).mockResolvedValue(data);
  vi.mocked(internal.saveCustomerDetails).mockResolvedValue(data);
  vi.mocked(internal.getCustomerOptions).mockResolvedValue({
    customer_types: ['Company'],
    customer_groups: ['Commercial'],
    territories: ['Cameroon'],
    countries: ['Cameroon', 'France'],
    currencies: ['XAF', 'USD'],
    price_lists: ['Standard Selling'],
    payment_terms: ['30 days'],
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/msp/customers/ACME']}>
        <Routes>
          <Route path="/msp/customers/:customer" element={<Customer360 />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await screen.findByText('ACME Corporation');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('one page, whichever side is reading it', () => {
  it('leads with who the company is and what they carry', async () => {
    await renderPage(detail());

    expect(screen.getByText('ACME Corporation')).toBeInTheDocument();
    expect(screen.getByText('126')).toBeInTheDocument();
    expect(screen.getByText('83')).toBeInTheDocument();
  });

  it('lets our own administrator set the commercial terms', async () => {
    await renderPage(detail());

    expect(screen.getByText(/commercial terms/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('TX-1')).toBeEnabled();
    expect(screen.getByRole('button', { name: /contract and pricing/i })).toBeInTheDocument();
  });

  it('shows a customer their terms without letting them type', async () => {
    await renderPage(
      detail({
        can: {
          edit_commercial: false,
          edit_profile: true,
          manage_contracts: false,
          manage_pricing: false,
        },
      })
    );

    expect(screen.getByText(/set by your service provider/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('TX-1')).not.toBeInTheDocument();
    expect(screen.getByText('TX-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /contract and pricing/i })).not.toBeInTheDocument();
  });

  it('lets a customer correct where they are', async () => {
    await renderPage(
      detail({
        can: {
          edit_commercial: false,
          edit_profile: true,
          manage_contracts: false,
          manage_pricing: false,
        },
      })
    );

    fireEvent.change(screen.getByDisplayValue('Douala'), { target: { value: 'Yaoundé' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(internal.saveCustomerDetails).toHaveBeenCalledTimes(1));

    const sent = vi.mocked(internal.saveCustomerDetails).mock.calls[0][0];

    expect(sent.address?.city).toBe('Yaoundé');
    expect(sent.details).toEqual({ website: 'https://acme.example' });
  });

  it('offers nothing to save to somebody who may only read', async () => {
    await renderPage(
      detail({
        can: {
          edit_commercial: false,
          edit_profile: false,
          manage_contracts: false,
          manage_pricing: false,
        },
      })
    );

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });
});

describe('a record two companies share', () => {
  it('says so on the address, and locks it', async () => {
    await renderPage(detail({ shared: { address: true } }));

    expect(screen.getByText(/shared with another company/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('1 High Street')).toBeDisabled();
  });

  it('never sends a shared record back to be saved', async () => {
    await renderPage(detail({ shared: { address: true } }));

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(internal.saveCustomerDetails).toHaveBeenCalledTimes(1));
    expect(vi.mocked(internal.saveCustomerDetails).mock.calls[0][0].address).toBeUndefined();
  });
});

describe('what the page leaves out', () => {
  it('has no contact section', async () => {
    await renderPage(detail());

    expect(screen.queryByText(/who to call/i)).not.toBeInTheDocument();
  });
});
