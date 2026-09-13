import type { CustomerDetails } from '@/lib/api/internal';

const CUSTOMER_FIELDS = [
  'customer_name',
  'customer_type',
  'customer_group',
  'territory',
  'tax_id',
  'default_currency',
  'default_price_list',
  'payment_terms',
  'website',
  'msp_free_of_charge',
] as const;

export const editableCustomerDetails = (details: Partial<CustomerDetails>) =>
  Object.fromEntries(
    CUSTOMER_FIELDS.filter((field) => details[field] !== undefined).map((field) => [
      field,
      details[field],
    ])
  ) as Partial<CustomerDetails>;
