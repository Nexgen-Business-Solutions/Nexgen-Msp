import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const contractKeys = {
  all: ['internal', 'contracts'] as const,
  options: () => [...contractKeys.all, 'options'] as const,
  list: () => [...contractKeys.all, 'list'] as const,
  detail: (customer: string) => [...contractKeys.all, 'detail', customer] as const,
  rates: (customer: string) => [...contractKeys.all, 'rates', customer] as const,
};

export const useContractOptions = () =>
  useQuery({
    queryKey: contractKeys.options(),
    queryFn: ({ signal }) => internal.getContractOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useContractList = () =>
  useQuery({
    queryKey: contractKeys.list(),
    queryFn: ({ signal }) => internal.listContracts(signal),
    staleTime: 60 * 1000,
  });

export const useContract = (customer?: string) =>
  useQuery({
    queryKey: contractKeys.detail(customer || ''),
    queryFn: ({ signal }) => internal.getContract(customer as string, signal),
    enabled: Boolean(customer),
  });

export const useSaveContract = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveContract,
    onSuccess: (detail) => {
      queryClient.setQueryData(contractKeys.detail(detail.customer), detail);
      queryClient.invalidateQueries({ queryKey: contractKeys.list() });
    },
  });
};

export const useContractRates = (customer?: string) =>
  useQuery({
    queryKey: contractKeys.rates(customer || ''),
    queryFn: ({ signal }) => internal.listContractRates(customer as string, signal),
    enabled: Boolean(customer),
  });

const useRateMutation = <TVariables, TResult>(
  customer: string,
  mutationFn: (variables: TVariables) => Promise<TResult>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.rates(customer) });
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(customer) });
      queryClient.invalidateQueries({ queryKey: contractKeys.list() });
    },
  });
};

export const useSaveRate = (customer: string) =>
  useRateMutation(customer, internal.saveContractRate);

export const useDeleteRate = (customer: string) =>
  useRateMutation(customer, internal.deleteContractRate);

export const useSetEligibility = (customer: string) =>
  useRateMutation(customer, internal.setServiceEligibility);

export const authorityKeys = {
  one: (customer: string) => ['internal', 'authority', customer] as const,
};

export const useCustomerAuthority = (customer?: string) =>
  useQuery({
    queryKey: authorityKeys.one(customer ?? ''),
    queryFn: ({ signal }) => internal.getCustomerAuthority(customer as string, signal),
    enabled: Boolean(customer),
  });

export const useSaveCustomerAuthority = (customer: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveCustomerAuthority,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: authorityKeys.one(customer) }),
  });
};
