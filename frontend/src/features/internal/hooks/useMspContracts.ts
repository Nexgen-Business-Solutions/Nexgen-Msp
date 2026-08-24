import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { contractKeys } from './useContracts';

export const mspContractKeys = {
  all: ['internal', 'mspContracts'] as const,
  options: () => [...mspContractKeys.all, 'options'] as const,
  list: (params: Record<string, unknown>) => [...mspContractKeys.all, 'list', params] as const,
  detail: (name: string) => [...mspContractKeys.all, 'detail', name] as const,
};

export const useMspContractOptions = () =>
  useQuery({
    queryKey: mspContractKeys.options(),
    queryFn: ({ signal }) => internal.getMspContractOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useMspContracts = (
  params: { customer?: string; status?: string; billable_only?: number } = {}
) =>
  useQuery({
    queryKey: mspContractKeys.list(params),
    queryFn: ({ signal }) => internal.listMspContracts(params, signal),
    staleTime: 60 * 1000,
  });

export const useMspContract = (name?: string) =>
  useQuery({
    queryKey: mspContractKeys.detail(name || ''),
    queryFn: ({ signal }) => internal.getMspContract(name as string, signal),
    enabled: Boolean(name),
  });

export const useSaveMspContract = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveMspContract,
    onSuccess: (detail) => {
      queryClient.setQueryData(mspContractKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: mspContractKeys.all });
      // the contract now decides what is offered and priced, so its page must follow
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
};

export const useSetMspContractStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { name: string; status: string }) =>
      internal.setMspContractStatus(variables.name, variables.status),
    onSuccess: (detail) => {
      queryClient.setQueryData(mspContractKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: mspContractKeys.all });
      // the contract now decides what is offered and priced, so its page must follow
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
};
