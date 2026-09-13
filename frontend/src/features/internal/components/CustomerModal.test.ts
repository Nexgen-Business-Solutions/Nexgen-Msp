import { describe, expect, it } from 'vitest';
import type { CustomerDetails } from '@/lib/api/internal';
import { editableCustomerDetails } from './customerFields';

describe('the customer modal payload', () => {
  it('does not send response-only fields back to the strict API', () => {
    const details = {
      name: 'ACME',
      customer_name: 'Acme Corporation',
      website: 'https://acme.example',
      counts: { users: 2, devices: 1, contracts: 1 },
      can: { edit_commercial: true },
      address: { name: 'ADDR-1' },
      contact: { name: 'CONTACT-1' },
      last_billed_on: '2026-08-31',
    } as unknown as CustomerDetails;

    expect(editableCustomerDetails(details)).toEqual({
      customer_name: 'Acme Corporation',
      website: 'https://acme.example',
    });
  });
});
