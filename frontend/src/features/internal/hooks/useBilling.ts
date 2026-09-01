import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const billingKeys = {
  all: ['internal', 'billing'] as const,
  list: (params: Record<string, unknown>) => [...billingKeys.all, 'list', params] as const,
  detail: (name: string) => [...billingKeys.all, 'detail', name] as const,
};

export const useBillingRuns = (query: internal.BillingRunQuery = {}) =>
  useQuery({
    queryKey: billingKeys.list(query as Record<string, unknown>),
    queryFn: ({ signal }) => internal.listBillingRuns({ ...query, page_length: 100 }, signal),
    keepPreviousData: true,
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
    mutationFn: (variables: {
      action: string;
      name: string;
      extra?: Record<string, unknown>;
    }) => internal.runBillingAction(variables.action, variables.name, variables.extra),
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

export const useSetLineDiscount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.setBillingLineDiscount,
    onSuccess: (detail) => {
      queryClient.setQueryData(billingKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: [...billingKeys.all, 'list'] });
    },
  });
};

export const useInvoiceDimensions = (enabled = true) =>
  useQuery({
    queryKey: [...billingKeys.all, 'dimensions'] as const,
    queryFn: ({ signal }) => internal.getInvoiceDimensions(signal),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

export const useCreateCostCenter = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.createCostCenter,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...billingKeys.all, 'dimensions'] }),
  });
};

export const useBillingPeriodStatus = (
  contract: string,
  periodStart: string,
  periodEnd: string,
  enabled = true
) =>
  useQuery({
    queryKey: [...billingKeys.all, 'period', contract, periodStart, periodEnd] as const,
    queryFn: ({ signal }) =>
      internal.getBillingPeriodStatus(
        { contract, period_start: periodStart, period_end: periodEnd },
        signal
      ),
    enabled: enabled && Boolean(contract && periodStart && periodEnd),
    // an already-covered period is a warning, not a blocker: a failure stays silent
    retry: false,
    staleTime: 30 * 1000,
  });

export const useBillingInvoice = (run?: string, enabled = true) =>
  useQuery({
    queryKey: [...billingKeys.detail(run || ''), 'invoice'] as const,
    queryFn: ({ signal }) => internal.getBillingInvoice(run as string, signal),
    enabled: enabled && Boolean(run),
  });

export const useExchangePreview = (run: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['internal', 'billing', 'exchange', run] as const,
    queryFn: ({ signal }) => internal.getExchangePreview(run as string, signal),
    enabled: Boolean(run) && enabled,
    staleTime: 60 * 1000,
  });
