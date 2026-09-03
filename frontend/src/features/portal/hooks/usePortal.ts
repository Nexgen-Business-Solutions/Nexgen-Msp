import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as portal from '@/lib/api/portal';
import { usePortalFilters, emptyFilters, type ListKey } from '../store/usePortalFilters';

export const portalKeys = {
  all: ['portal'] as const,
  context: () => [...portalKeys.all, 'context'] as const,
  summary: (customer?: string | null) => [...portalKeys.all, 'summary', customer] as const,
  list: (key: ListKey, customer: string | null, params: portal.ListParams) =>
    [...portalKeys.all, key, customer, params] as const,
  request: (name: string) => [...portalKeys.all, 'request', name] as const,
  catalogue: (customer?: string | null) => [...portalKeys.all, 'catalogue', customer] as const,
  subscribed: (customer?: string | null) => [...portalKeys.all, 'subscribed', customer] as const,
  serviceRows: (customer: string | null, params: Record<string, unknown>) =>
    [...portalKeys.all, 'serviceRows', customer, params] as const,
  kpiRows: (customer: string | null, params: Record<string, unknown>) =>
    [...portalKeys.all, 'kpiRows', customer, params] as const,
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

/** The people and machines listings, which page and filter on their own. */
export const useClientUserPage = (params: portal.ListParams) => {
  const customer = usePortalFilters((state) => state.customer);
  const scoped = { ...params, customer: customer || undefined };

  return useQuery({
    queryKey: portalKeys.list('clientUsers', customer, scoped),
    queryFn: ({ signal }) => portal.listClientUsers(scoped, signal),
    keepPreviousData: true,
  });
};

export const useDevicePage = (params: portal.ListParams) => {
  const customer = usePortalFilters((state) => state.customer);
  const scoped = { ...params, customer: customer || undefined };

  return useQuery({
    queryKey: portalKeys.list('devices', customer, scoped),
    queryFn: ({ signal }) => portal.listDevices(scoped, signal),
    keepPreviousData: true,
  });
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
      request_type?: string;
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

export const usePortalUserDetail = (clientUser?: string) =>
  useQuery({
    queryKey: [...portalKeys.all, 'userDetail', clientUser] as const,
    queryFn: ({ signal }) => portal.getUserDetail(clientUser as string, signal),
    enabled: Boolean(clientUser),
  });

export const useSubscribedServices = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: portalKeys.subscribed(customer),
    queryFn: ({ signal }) => portal.listSubscribedServices(customer || undefined, signal),
    staleTime: 60 * 1000,
  });
};

export const useServiceRows = (serviceItem: string) => {
  const customer = usePortalFilters((state) => state.customer);
  const filters = usePortalFilters(
    (state) => state.serviceFilters[serviceItem] ?? emptyFilters
  );

  const params = {
    customer: customer || undefined,
    service_item: serviceItem,
    search: filters.search || undefined,
    status: filters.status || undefined,
    start: filters.start,
    page_length: filters.pageLength,
  };

  const query = useQuery({
    queryKey: portalKeys.serviceRows(customer, params),
    queryFn: ({ signal }) => portal.listServiceRows(params, signal),
    keepPreviousData: true,
    enabled: Boolean(serviceItem),
  });

  return { ...query, filters };
};

export const useKpiRows = (kpi: portal.KpiName | null, start: number, pageLength: number) => {
  const customer = usePortalFilters((state) => state.customer);

  const params = {
    kpi: kpi as portal.KpiName,
    customer: customer || undefined,
    start,
    page_length: pageLength,
  };

  return useQuery({
    queryKey: portalKeys.kpiRows(customer, params),
    queryFn: ({ signal }) => portal.listKpiRows(params, signal),
    keepPreviousData: true,
    enabled: Boolean(kpi),
  });
};

export const useUsersWithServices = (limit?: number) => {
  const { customer, filters, params } = useListParams('clientUsers', limit);
  const query = useQuery({
    queryKey: [...portalKeys.all, 'usersWithServices', customer, params],
    queryFn: ({ signal }) => portal.listUsersWithServices(params, signal),
    keepPreviousData: true,
  });

  return { ...query, filters };
};

export const usePortalBilling = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: [...portalKeys.all, 'billing', customer] as const,
    queryFn: ({ signal }) => portal.listBilling(customer || undefined, signal),
    staleTime: 60 * 1000,
  });
};

export const usePortalBillingDetail = (name?: string) =>
  useQuery({
    queryKey: [...portalKeys.all, 'billingDetail', name] as const,
    queryFn: ({ signal }) => portal.getBillingDetail(name as string, signal),
    enabled: Boolean(name),
  });

export const usePortalRequestOptions = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: [...portalKeys.all, 'requestOptions', customer] as const,
    queryFn: ({ signal }) => portal.getRequestFilterOptions(customer || undefined, signal),
    staleTime: 5 * 60 * 1000,
  });
};

export const usePortalRequestList = (
  query: portal.ListParams & { priority?: string; request_type?: string }
) => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: [...portalKeys.all, 'requestList', customer, query] as const,
    queryFn: ({ signal }) => portal.listRequests({ ...query, customer: customer || undefined }, signal),
    keepPreviousData: true,
  });
};

export const useDisputeInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: portal.disputeInvoice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portalKeys.all }),
  });
};

export const useRecentActivity = (limit = 12) => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: [...portalKeys.all, 'activity', customer, limit] as const,
    queryFn: ({ signal }) => portal.getRecentActivity(customer || undefined, limit, signal),
    staleTime: 30 * 1000,
  });
};

export const useRequestActions = () =>
  useQuery({
    queryKey: [...portalKeys.all, 'requestActions'] as const,
    queryFn: ({ signal }) => portal.listRequestActions(false, signal),
    staleTime: 10 * 60 * 1000,
  });

export const useServiceState = (
  serviceItem?: string,
  clientUser?: string,
  managedDevice?: string
) =>
  useQuery({
    queryKey: [...portalKeys.all, 'serviceState', serviceItem, clientUser, managedDevice] as const,
    queryFn: ({ signal }) =>
      portal.getServiceState(
        { service_item: serviceItem as string, client_user: clientUser, managed_device: managedDevice },
        signal
      ),
    enabled: Boolean(serviceItem && (clientUser || managedDevice)),
  });

export const useUserChoices = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: [...portalKeys.all, 'userChoices', customer] as const,
    queryFn: ({ signal }) => portal.listUserChoices(customer || undefined, signal),
    staleTime: 60 * 1000,
  });
};

export const useDeviceChoices = () => {
  const customer = usePortalFilters((state) => state.customer);

  return useQuery({
    queryKey: [...portalKeys.all, 'deviceChoices', customer] as const,
    queryFn: ({ signal }) => portal.listDeviceChoices(customer || undefined, signal),
    staleTime: 60 * 1000,
  });
};

export const useMyApprovalRights = () =>
  useQuery({
    queryKey: ['portal', 'approvalRights'] as const,
    queryFn: ({ signal }) => portal.getMyApprovalRights(signal),
    staleTime: 60 * 1000,
  });

export const useDecideRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { name: string; approve: boolean; reason?: string }) =>
      variables.approve
        ? portal.approveRequest(variables.name, variables.reason)
        : portal.rejectRequest(variables.name, variables.reason ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal'] }),
  });
};
