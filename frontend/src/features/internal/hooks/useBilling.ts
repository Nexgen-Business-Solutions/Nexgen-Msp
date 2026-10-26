import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const billingKeys = {
  all: ['internal', 'billing'] as const,
  detail: (name: string) => [...billingKeys.all, 'detail', name] as const,
};

/** One read for the Billing page: figures, the work waiting, and the open tab's list. */
export const useBillingWorkspace = (query: internal.BillingWorkspaceQuery = {}) =>
  useQuery({
    queryKey: [...billingKeys.all, 'workspace', query] as const,
    queryFn: ({ signal }) => internal.getBillingWorkspace(query, signal),
    keepPreviousData: true,
    staleTime: 30 * 1000,
  });

/** One read for a run's page: the record, its stage, its moves and its history. */
export const useBillingRunView = (name?: string) =>
  useQuery({
    queryKey: [...billingKeys.detail(name || ''), 'view'] as const,
    queryFn: ({ signal }) => internal.getBillingRunView(name as string, signal),
    enabled: Boolean(name),
  });

export const useSalesInvoice = (name?: string) =>
  useQuery({
    queryKey: [...billingKeys.all, 'invoice', name],
    queryFn: ({ signal }) => internal.getSalesInvoiceDetail(name as string, signal),
    enabled: Boolean(name),
  });

/** The one preparation path, one read per step. */
export const useOperationContext = (query: internal.BillingOperationQuery | null) =>
  useQuery({
    queryKey: [...billingKeys.all, 'operation', 'context', query] as const,
    queryFn: ({ signal }) => internal.getBillingOperationContext(query!, signal),
    enabled: Boolean(query?.contract),
  });

export const useOperationServices = (query: internal.BillingOperationQuery | null) =>
  useQuery({
    queryKey: [...billingKeys.all, 'operation', 'services', query] as const,
    queryFn: ({ signal }) => internal.getBillingOperationServices(query!, signal),
    enabled: Boolean(query?.contract),
    keepPreviousData: true,
  });

export const useOperationAccounting = (contract?: string, enabled = true) =>
  useQuery({
    queryKey: [...billingKeys.all, 'operation', 'accounting', contract] as const,
    queryFn: ({ signal }) => internal.getBillingOperationAccounting(contract as string, signal),
    enabled: Boolean(contract) && enabled,
  });

export const useCreditPreview = () =>
  useMutation({ mutationFn: internal.getBillingCreditPreview });

export const useCreateOperation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.createBillingOperation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

/** Every move a run allows, taken on the run's own page. */
export const useRunAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { action: string; name: string; extra?: Record<string, unknown> }) =>
      internal.runBillingAction(variables.action, variables.name, variables.extra),
    onSuccess: (detail) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.detail(detail.name) });
      queryClient.invalidateQueries({ queryKey: [...billingKeys.all, 'workspace'] });
    },
  });
};

/** Changing what a run is billing: its scope, never the services themselves. */
const useScopeChange = <TVariables>(
  mutationFn: (variables: TVariables) => Promise<internal.BillingRunDetail>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.detail(detail.name) });
      queryClient.invalidateQueries({ queryKey: [...billingKeys.all, 'workspace'] });
    },
  });
};

export const useRemoveFromBillingRun = () => useScopeChange(internal.removeFromBillingRun);

export const useSetLineDiscount = () => useScopeChange(internal.setBillingLineDiscount);

/** The reconciliation of a charge raised before this application. */
export const useCoverageEvidence = (
  payload: { customer: string; period_start: string; period_end: string } | null
) =>
  useQuery({
    queryKey: [...billingKeys.all, 'coverage', payload],
    queryFn: ({ signal }) => internal.getCoverageEvidence(payload!, signal),
    enabled: Boolean(payload),
  });

export const useCoveragePreview = (
  payload: {
    contract: string;
    period_start: string;
    period_end: string;
    invoice_date?: string;
  } | null
) =>
  useQuery({
    queryKey: [...billingKeys.all, 'coverage-preview', payload],
    queryFn: ({ signal }) => internal.previewPastCoverage(payload!, signal),
    enabled: Boolean(payload),
  });

export const useRecordPastCoverage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.recordPastCoverage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: billingKeys.all }),
  });
};

/** What ERPNext asks of a document, and who is told once it is posted. */
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

export const useInvoiceRecipients = (name?: string) =>
  useQuery({
    queryKey: [...billingKeys.detail(name || ''), 'recipients'],
    queryFn: ({ signal }) => internal.getInvoiceRecipients(name as string, signal),
    enabled: Boolean(name),
  });

export const useBillingInvoice = (run?: string, enabled = true) =>
  useQuery({
    queryKey: [...billingKeys.detail(run || ''), 'invoice'] as const,
    queryFn: ({ signal }) => internal.getBillingInvoice(run as string, signal),
    enabled: enabled && Boolean(run),
  });

/** Who one invoice can be sent to, and what was sent before. */
export const useInvoiceEmailRecipients = (invoice?: string) =>
  useQuery({
    queryKey: [...billingKeys.all, 'invoice-email', invoice ?? ''] as const,
    queryFn: ({ signal }) => internal.getInvoiceEmailRecipients(invoice as string, signal),
    enabled: Boolean(invoice),
    staleTime: 0,
  });

export const useSendInvoiceEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.sendInvoiceEmail,
    onSuccess: (_attempt, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...billingKeys.all, 'invoice-email', variables.name],
      });
    },
  });
};

export const useExchangePreview = (run: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: [...billingKeys.all, 'exchange', run] as const,
    queryFn: ({ signal }) => internal.getExchangePreview(run as string, signal),
    enabled: Boolean(run) && enabled,
    staleTime: 60 * 1000,
  });
