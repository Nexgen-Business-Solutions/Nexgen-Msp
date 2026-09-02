import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

export const requestKeys = {
  all: ['internal', 'requests'] as const,
  options: () => [...requestKeys.all, 'options'] as const,
  stats: () => [...requestKeys.all, 'stats'] as const,
  list: (params: internal.RequestListParams) => [...requestKeys.all, 'list', params] as const,
  detail: (name: string) => [...requestKeys.all, 'detail', name] as const,
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
  scope: 'open',
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
      queryClient.invalidateQueries({ queryKey: [...requestKeys.all, 'list'] });
      queryClient.invalidateQueries({ queryKey: requestKeys.stats() });
    },
  });
};

export const useRunRequestAction = () =>
  useDetailMutation((variables: { name: string; action: string; reason?: string }) =>
    internal.runRequestAction(variables)
  );

export const useSetLineStatus = () =>
  useDetailMutation(
    (variables: { name: string; idx: number; line_status: string; reason?: string }) =>
      internal.setRequestLineStatus(variables)
  );

export const useSetDeliveryDetail = () =>
  useDetailMutation(
    (variables: { name: string; idx: number; serial_number?: string; username?: string }) =>
      internal.setRequestDeliveryDetail(variables)
  );



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
