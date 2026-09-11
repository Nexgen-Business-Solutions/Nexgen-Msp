import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const customerKeys = {
  all: ['internal', 'customerDetails'] as const,
  options: () => [...customerKeys.all, 'options'] as const,
  detail: (customer: string) => [...customerKeys.all, customer] as const,
};

export const useCustomerOptions = (enabled = true) =>
  useQuery({
    queryKey: customerKeys.options(),
    enabled,
    queryFn: ({ signal }) => internal.getCustomerOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useCustomerDetails = (customer?: string, ownProfile = false) =>
  useQuery({
    queryKey: customerKeys.detail(customer || '__own__'),
    queryFn: ({ signal }) => internal.getCustomerDetails(customer, signal),
    enabled: Boolean(customer) || ownProfile,
  });

export const useSaveCustomerDetails = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveCustomerDetails,
    onSuccess: (detail) => {
      queryClient.setQueryData(customerKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'contracts'] });
    },
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.createCustomer,
    onSuccess: async (detail) => {
      queryClient.setQueryData(customerKeys.detail(detail.name), detail);
      await queryClient.invalidateQueries({ queryKey: ['internal'] });
    },
  });
};

export const useCustomerList = () =>
  useQuery({
    queryKey: [...customerKeys.all, 'list'],
    queryFn: ({ signal }) => internal.listCustomers(signal),
  });
