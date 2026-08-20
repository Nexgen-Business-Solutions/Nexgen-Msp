import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const billingKeys = {
  all: ['internal', 'billing'] as const,
  list: (params: Record<string, unknown>) => [...billingKeys.all, 'list', params] as const,
  detail: (name: string) => [...billingKeys.all, 'detail', name] as const,
};

export const useBillingRuns = (customer?: string, status?: string) =>
  useQuery({
    queryKey: billingKeys.list({ customer, status }),
    queryFn: ({ signal }) =>
      internal.listBillingRuns(
        { customer: customer || undefined, status: status || undefined, page_length: 100 },
        signal
      ),
    staleTime: 30 * 1000,
  });

export const useBillingRun = (name?: string) =>
  useQuery({
    queryKey: billingKeys.detail(name || ''),
    queryFn: ({ signal }) => internal.getBillingRun(name as string, signal),
    enabled: Boolean(name),
  });

export const usePreviewRun = () =>
  useMutation({ mutationFn: internal.previewBillingRun });

export const useGenerateRun = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.generateBillingRun,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

export const useRunAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { action: string; name: string }) =>
      internal.runBillingAction(variables.action, variables.name),
    onSuccess: (detail) => {
      queryClient.setQueryData(billingKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: [...billingKeys.all, 'list'] });
    },
  });
};

export const useBillingFilterOptions = (customer?: string) =>
  useQuery({
    queryKey: [...billingKeys.all, 'filterOptions', customer] as const,
    queryFn: ({ signal }) => internal.getBillingFilterOptions(customer as string, signal),
    enabled: Boolean(customer),
    staleTime: 5 * 60 * 1000,
  });

export const useBillingBreakdown = (name?: string) =>
  useQuery({
    queryKey: [...billingKeys.detail(name || ''), 'breakdown'] as const,
    queryFn: ({ signal }) => internal.getBillingBreakdown(name as string, signal),
    enabled: Boolean(name),
  });

export const useCreditableLines = (name?: string) =>
  useQuery({
    queryKey: [...billingKeys.detail(name || ''), 'creditable'] as const,
    queryFn: ({ signal }) => internal.getCreditableLines(name as string, signal),
    enabled: Boolean(name),
  });

export const useCreateCreditNote = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.createCreditNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

export const useBillingDue = (horizonDays = 30) =>
  useQuery({
    queryKey: [...billingKeys.all, 'due', horizonDays] as const,
    queryFn: ({ signal }) => internal.getBillingDue(horizonDays, signal),
    staleTime: 60 * 1000,
  });
