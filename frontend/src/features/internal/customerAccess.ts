import type { SessionContext } from '@/lib/api/session';
import type { CustomerDetails } from '@/lib/api/internal';

export const customerRole = (session?: SessionContext) => {
  if (!session?.authenticated) return null;
  if (session.customer_profile_role !== undefined) return session.customer_profile_role;
  const roles = session.roles;
  if (session.user === 'Administrator' && roles.includes('MSP System Admin')) return 'MSP System Admin';
  if (roles.includes('MSP Customer Operator')) return 'MSP Customer Operator';
  if (roles.includes('MSP Customer Manager')) return 'MSP Customer Manager';
  if (roles.includes('MSP System Admin')) return 'MSP System Admin';
  if (roles.includes('MSP Technician')) return 'MSP Technician';
  return null;
};

export const customerChanges = (form: Partial<CustomerDetails>, profileOnly: boolean) => {
  const fields: (keyof CustomerDetails)[] = profileOnly ? ['website'] : [
    'customer_name', 'customer_type', 'customer_group', 'territory', 'tax_id',
    'default_currency', 'default_price_list', 'payment_terms', 'website', 'msp_free_of_charge',
  ];
  return Object.fromEntries(fields.filter((field) => field in form).map((field) => [field, form[field]]));
};
