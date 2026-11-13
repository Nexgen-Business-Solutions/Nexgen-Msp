import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const customerKeys = {
  all: ['internal', 'customerDetails'] as const,
  options: () => [...customerKeys.all, 'options'] as const,
  detail: (customer: string) => [...customerKeys.all, customer] as const,
};

export const useCustomerOptions = () =>
  useQuery({
    queryKey: customerKeys.options(),
    queryFn: ({ signal }) => internal.getCustomerOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useCustomerDetails = (customer?: string) =>
  useQuery({
    queryKey: customerKeys.detail(customer || ''),
    queryFn: ({ signal }) => internal.getCustomerDetails(customer as string, signal),
    enabled: Boolean(customer),
  });

export const useCustomerContacts = (customer?: string) =>
  useQuery({
    queryKey: [...customerKeys.detail(customer || ''), 'contacts'],
    queryFn: ({ signal }) => internal.listCustomerContacts(customer as string, signal),
    enabled: Boolean(customer),
  });

/** Naming who the invoices are announced to, or adding somebody who has no account. */
export const useSetBillingContact = (customer: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.setCustomerBillingContact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(customer) });
    },
  });
};

export const useAddBillingContact = (customer: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.addCustomerBillingContact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(customer) });
    },
  });
};

export const useSaveCustomerDetails = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveCustomerDetails,
    onSuccess: (detail) => {
      queryClient.setQueryData(customerKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: ['internal', 'contracts'] });
    },
  });
};

/** What this account may do, asked once and shared by every screen that has to decide. */
export const useCapabilities = () =>
  useQuery({
    queryKey: ['internal', 'capabilities'] as const,
    queryFn: ({ signal }) => internal.getMyCapabilities(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useCustomerDirectory = (search?: string) =>
  useQuery({
    queryKey: [...customerKeys.all, 'directory', search ?? ''] as const,
    queryFn: ({ signal }) => internal.listCustomers(search, signal),
    keepPreviousData: true,
  });

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.createCustomer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
};
