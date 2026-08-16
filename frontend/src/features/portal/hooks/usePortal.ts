import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import { usePortalFilters, type ListKey } from '../store/usePortalFilters';

export const portalKeys = {
  all: ['portal'] as const,
  context: () => [...portalKeys.all, 'context'] as const,
  summary: (customer?: string | null) => [...portalKeys.all, 'summary', customer] as const,
  list: (key: ListKey, customer: string | null, params: portal.ListParams) =>
    [...portalKeys.all, key, customer, params] as const,
  request: (name: string) => [...portalKeys.all, 'request', name] as const,
  catalogue: (customer?: string | null) => [...portalKeys.all, 'catalogue', customer] as const,
};

const useListParams = (key: ListKey, limit?: number) => {
  const customer = usePortalFilters((state) => state.customer);
  const filters = usePortalFilters((state) => state.filters[key]);

  const params: portal.ListParams = limit
    ? { customer: customer || undefined, start: 0, page_length: limit }
    : {
        customer: customer || undefined,
        search: filters.search || undefined,
        status: filters.status || undefined,
        start: filters.start,
        page_length: filters.pageLength,
      };

  return { customer, filters, params };
};

export const usePortalContext = () =>
  useQuery({
    queryKey: portalKeys.context(),
    queryFn: ({ signal }) => portal.getContext(signal),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

export const usePortalSummary = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: portalKeys.summary(customer),
    queryFn: ({ signal }) => portal.getSummary(customer || undefined, signal),
    staleTime: 60 * 1000,
  });
};

export const useClientUsers = (limit?: number) => {
  const { customer, filters, params } = useListParams('clientUsers', limit);
  const query = useQuery({
    queryKey: portalKeys.list('clientUsers', customer, params),
    queryFn: ({ signal }) => portal.listClientUsers(params, signal),
    keepPreviousData: true,
  });

  return { ...query, filters };
};

export const useDevices = (limit?: number) => {
  const { customer, filters, params } = useListParams('devices', limit);
  const query = useQuery({
    queryKey: portalKeys.list('devices', customer, params),
    queryFn: ({ signal }) => portal.listDevices(params, signal),
    keepPreviousData: true,
  });

  return { ...query, filters };
};

export const useServiceAssignments = (clientUser?: string, limit?: number) => {
  const { customer, filters, params } = useListParams('services', limit);
  const scoped = { ...params, client_user: clientUser || undefined };

  const query = useQuery({
    queryKey: portalKeys.list('services', customer, scoped),
    queryFn: ({ signal }) => portal.listServiceAssignments(scoped, signal),
    keepPreviousData: true,
  });

  return { ...query, filters };
};

export const useServiceRequests = (limit?: number) => {
  const { customer, filters, params } = useListParams('requests', limit);
  const query = useQuery({
    queryKey: portalKeys.list('requests', customer, params),
    queryFn: ({ signal }) => portal.listRequests(params, signal),
    keepPreviousData: true,
  });

  return { ...query, filters };
};

export const useServiceRequest = (name?: string) =>
  useQuery({
    queryKey: portalKeys.request(name || ''),
    queryFn: ({ signal }) => portal.getRequest(name as string, signal),
    enabled: Boolean(name),
  });

export const useCatalogue = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: portalKeys.catalogue(customer),
    queryFn: ({ signal }) => portal.listCatalogue(customer || undefined, signal),
    staleTime: 10 * 60 * 1000,
  });
};

export const useCreateServiceRequest = () => {
  const queryClient = useQueryClient();
  const customer = usePortalFilters((state) => state.customer);

  return useMutation({
    mutationFn: (payload: {
      request_type: string;
      priority?: string;
      lines: portal.NewRequestLine[];
    }) => portal.createRequest({ ...payload, customer: customer || undefined }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: [...portalKeys.all, 'requests'] });
      queryClient.invalidateQueries({ queryKey: portalKeys.summary(customer) });
      queryClient.setQueryData(portalKeys.request(created.name), created);
    },
  });
};
