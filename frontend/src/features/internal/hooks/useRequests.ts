import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { getInternalRequestPresentation } from '@/lib/api/requestPresentation';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

export const requestKeys = {
  all: ['internal', 'requests'] as const,
  options: () => [...requestKeys.all, 'options'] as const,
  stats: () => [...requestKeys.all, 'stats'] as const,
  list: (params: internal.RequestListParams) => [...requestKeys.all, 'list', params] as const,
  detail: (name: string) => [...requestKeys.all, 'detail', name] as const,
  plan: (name: string) => [...requestKeys.all, 'plan', name] as const,
  presentation: (name: string) => [...requestKeys.all, 'presentation', name] as const,
};

export type RequestFilterState = {
  search: string;
  status: string;
  priority: string;
  request_type: string;
  customer: string;
  scope: string;
  start: number;
  pageLength: number;
};

const DEFAULTS: RequestFilterState = {
  search: '',
  status: '',
  priority: '',
  request_type: '',
  customer: '',
  scope: 'all',
  start: 0,
  pageLength: 20,
};

/** Filters live in the URL so a filtered queue can be bookmarked and shared. */
export const useRequestFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: RequestFilterState = useMemo(
    () => ({
      search: searchParams.get('q') ?? DEFAULTS.search,
      status: searchParams.get('status') ?? DEFAULTS.status,
      priority: searchParams.get('priority') ?? DEFAULTS.priority,
      request_type: searchParams.get('type') ?? DEFAULTS.request_type,
      customer: searchParams.get('customer') ?? DEFAULTS.customer,
      scope: searchParams.get('scope') ?? DEFAULTS.scope,
      start: Number(searchParams.get('start') ?? DEFAULTS.start),
      pageLength: Number(searchParams.get('rows') ?? DEFAULTS.pageLength),
    }),
    [searchParams]
  );

  const patch = useCallback(
    (changes: Partial<RequestFilterState>, keepStart = false) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const mapping: Record<string, string> = {
            search: 'q',
            status: 'status',
            priority: 'priority',
            request_type: 'type',
            customer: 'customer',
            scope: 'scope',
            start: 'start',
            pageLength: 'rows',
          };

          Object.entries(changes).forEach(([key, value]) => {
            const param = mapping[key];
            if (!param) return;

            const isDefault = String(value) === String(DEFAULTS[key as keyof RequestFilterState]);
            if (value === '' || value === undefined || isDefault) next.delete(param);
            else next.set(param, String(value));
          });

          if (!keepStart && !('start' in changes)) next.delete('start');

          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const clear = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);

  const activeCount = [
    filters.status,
    filters.priority,
    filters.request_type,
    filters.customer,
    filters.scope !== DEFAULTS.scope ? filters.scope : '',
  ].filter(Boolean).length;

  return { filters, patch, clear, activeCount };
};

export const useRequestFilterOptions = () =>
  useQuery({
    queryKey: requestKeys.options(),
    queryFn: ({ signal }) => internal.getRequestFilterOptions(signal),
    staleTime: 5 * 60 * 1000,
  });

export const useRequestStats = (params: internal.RequestListParams = {}) =>
  useQuery({
    queryKey: [...requestKeys.stats(), params] as const,
    queryFn: ({ signal }) => internal.getRequestStats(params, signal),
    staleTime: 30 * 1000,
  });

export const useRequestList = (filters: RequestFilterState) => {
  const debouncedSearch = useDebouncedValue(filters.search);

  const params: internal.RequestListParams = {
    search: debouncedSearch || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    request_type: filters.request_type || undefined,
    customer: filters.customer || undefined,
    scope: filters.scope || undefined,
    start: filters.start,
    page_length: filters.pageLength,
  };

  return useQuery({
    queryKey: requestKeys.list(params),
    queryFn: ({ signal }) => internal.listRequests(params, signal),
    keepPreviousData: true,
  });
};

export const useRequestDetail = (name?: string) =>
  useQuery({
    queryKey: requestKeys.detail(name || ''),
    queryFn: ({ signal }) => internal.getRequest(name as string, signal),
    enabled: Boolean(name),
  });

const useDetailMutation = <TVariables>(
  mutationFn: (variables: TVariables) => Promise<internal.RequestDetail>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      queryClient.setQueryData(requestKeys.detail(detail.name), detail);
      queryClient.invalidateQueries({ queryKey: requestKeys.presentation(detail.name) });
      queryClient.invalidateQueries({ queryKey: [...requestKeys.all, 'list'] });
      queryClient.invalidateQueries({ queryKey: requestKeys.stats() });
    },
  });
};

export const useRunRequestAction = () =>
  useDetailMutation((variables: { name: string; action: string; reason?: string }) =>
    internal.runRequestAction(variables)
  );

/** One decision for several lines; the answer says how each line took it. */
export const useSetLineStatuses = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.setRequestLineStatuses,
    onSuccess: (outcome) => {
      queryClient.setQueryData(requestKeys.detail(outcome.request.name), outcome.request);
      queryClient.invalidateQueries({ queryKey: requestKeys.presentation(outcome.request.name) });
      queryClient.invalidateQueries({ queryKey: [...requestKeys.all, 'list'] });
    },
  });
};

export const useSetLineStatus = () =>
  useDetailMutation(
    (variables: { name: string; idx: number; line_status: string; reason?: string }) =>
      internal.setRequestLineStatus(variables)
  );

export const useInternalRequestPresentation = (name?: string) =>
  useQuery({
    queryKey: requestKeys.presentation(name || ''),
    queryFn: ({ signal }) => getInternalRequestPresentation(name as string, signal),
    enabled: Boolean(name),
  });

/** The work an approved request turned into, as the technician's screen reads it. */
export const useRequestExecutionPlan = (name?: string) =>
  useQuery({
    queryKey: requestKeys.plan(name || ''),
    queryFn: ({ signal }) => internal.getRequestExecutionPlan(name as string, signal),
    enabled: Boolean(name),
  });

/** Every act on the plan gives the whole plan back, and the request itself has moved with it. */
const usePlanMutation = <TVariables>(
  mutationFn: (variables: TVariables) => Promise<internal.ExecutionPlan>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (plan) => {
      queryClient.setQueryData(requestKeys.plan(plan.request), plan);
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(plan.request) });
      queryClient.invalidateQueries({ queryKey: [...requestKeys.all, 'list'] });
      queryClient.invalidateQueries({ queryKey: requestKeys.stats() });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'devices'] });
    },
  });
};

export const useCompleteRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.completeRequest,
    onSuccess: async (plan) => {
      queryClient.setQueryData(requestKeys.plan(plan.request), plan);
      queryClient.invalidateQueries({ queryKey: [...requestKeys.all, 'list'] });
      queryClient.invalidateQueries({ queryKey: requestKeys.stats() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: requestKeys.detail(plan.request) }),
        queryClient.invalidateQueries({ queryKey: requestKeys.presentation(plan.request) }),
      ]);
    },
  });
};
export const useRecordRequestActivity = () => usePlanMutation(internal.recordRequestActivity);
export const useSettleWorkDoneElsewhere = () => usePlanMutation(internal.settleWorkDoneElsewhere);

const useRequestedEntityMutation = <TVariables>(
  mutationFn: (variables: TVariables) => Promise<internal.RequestedEntityOutcome>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (outcome) => {
      queryClient.setQueryData(requestKeys.plan(outcome.plan.request), outcome.plan);
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(outcome.plan.request) });
      queryClient.invalidateQueries({ queryKey: requestKeys.presentation(outcome.plan.request) });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'devices'] });
    },
  });
};

export const useSaveRequestedClientUser = () =>
  useRequestedEntityMutation(internal.saveRequestedClientUser);
export const useResolveRequestedClientUser = () =>
  useRequestedEntityMutation(internal.resolveRequestedClientUser);
export const useSaveRequestedDevice = () => useRequestedEntityMutation(internal.saveRequestedDevice);
export const useResolveRequestedDevice = () =>
  useRequestedEntityMutation(internal.resolveRequestedDevice);
export const useCancelRequestedClientUser = () =>
  useRequestedEntityMutation(internal.cancelRequestedClientUser);
export const useCancelRequestedDevice = () => useRequestedEntityMutation(internal.cancelRequestedDevice);

export const useSelectableClientUsers = (customer: string | null, search: string) => {
  const debounced = useDebouncedValue(search.trim(), 300);

  return useQuery({
    queryKey: [...requestKeys.all, 'selectableClientUsers', customer ?? '', debounced] as const,
    queryFn: ({ signal }) =>
      internal.listSelectableClientUsers(customer as string, debounced || undefined, signal),
    enabled: Boolean(customer),
    keepPreviousData: true,
  });
};

export const useSelectableDevices = (customer: string | null, search: string) => {
  const debounced = useDebouncedValue(search.trim(), 300);

  return useQuery({
    queryKey: [...requestKeys.all, 'selectableDevices', customer ?? '', debounced] as const,
    queryFn: ({ signal }) =>
      internal.listSelectableDevices(customer as string, debounced || undefined, signal),
    enabled: Boolean(customer),
    keepPreviousData: true,
  });
};



export const useInternalDashboard = () =>
  useQuery({
    queryKey: ['internal', 'dashboard'] as const,
    queryFn: ({ signal }) => internal.getDashboard(signal),
    staleTime: 30 * 1000,
  });

export const useCreateClientUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.createClientUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
    },
  });
};

export const useDashboardKpiRows = (
  kpi: internal.InternalKpiName | null,
  start: number,
  pageLength: number
) =>
  useQuery({
    queryKey: ['internal', 'dashboardKpi', kpi, start, pageLength] as const,
    queryFn: ({ signal }) =>
      internal.listDashboardKpiRows(
        { kpi: kpi as internal.InternalKpiName, start, page_length: pageLength },
        signal
      ),
    keepPreviousData: true,
    enabled: Boolean(kpi),
  });

/** One batch of ready work, whatever each unit is, carried out one Work Order at a time. */
export const useExecuteWorkOrders = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.executeWorkOrders,
    onSuccess: (outcome) => {
      queryClient.setQueryData(requestKeys.plan(outcome.plan.request), outcome.plan);
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(outcome.plan.request) });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'devices'] });
    },
  });
};

/** The identifiers a request is waiting on, written as many at a time as are known. */
export const useSaveRequiredIdentifiers = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveRequiredIdentifiers,
    onSuccess: (outcome) => {
      queryClient.setQueryData(requestKeys.plan(outcome.plan.request), outcome.plan);
      queryClient.invalidateQueries({ queryKey: requestKeys.detail(outcome.plan.request) });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'devices'] });
    },
  });
};
