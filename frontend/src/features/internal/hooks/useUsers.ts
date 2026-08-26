import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

export const userKeys = {
  all: ['internal', 'users'] as const,
  options: () => [...userKeys.all, 'options'] as const,
  stats: () => [...userKeys.all, 'stats'] as const,
  list: (params: internal.UserListParams) => [...userKeys.all, 'list', params] as const,
  detail: (name: string) => [...userKeys.all, 'detail', name] as const,
};

export type UserFilterState = {
  search: string;
  customer: string;
  status: string;
  department: string;
  service: string;
  coverage: string;
  portal: string;
  start: number;
  pageLength: number;
};

const DEFAULTS: UserFilterState = {
  search: '',
  customer: '',
  status: '',
  department: '',
  service: '',
  coverage: '',
  portal: '',
  start: 0,
  pageLength: 20,
};

const PARAMS: Record<string, string> = {
  search: 'q',
  customer: 'customer',
  status: 'status',
  department: 'dept',
  service: 'service',
  coverage: 'coverage',
  portal: 'portal',
  start: 'start',
  pageLength: 'rows',
};

export const useUserFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: UserFilterState = useMemo(
    () => ({
      search: searchParams.get('q') ?? DEFAULTS.search,
      customer: searchParams.get('customer') ?? DEFAULTS.customer,
      status: searchParams.get('status') ?? DEFAULTS.status,
      department: searchParams.get('dept') ?? DEFAULTS.department,
      service: searchParams.get('service') ?? DEFAULTS.service,
      coverage: searchParams.get('coverage') ?? DEFAULTS.coverage,
      portal: searchParams.get('portal') ?? DEFAULTS.portal,
      start: Number(searchParams.get('start') ?? DEFAULTS.start),
      pageLength: Number(searchParams.get('rows') ?? DEFAULTS.pageLength),
    }),
    [searchParams]
  );

  const patch = useCallback(
    (changes: Partial<UserFilterState>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);

          Object.entries(changes).forEach(([key, value]) => {
            const param = PARAMS[key];
            if (!param) return;

            const isDefault = String(value) === String(DEFAULTS[key as keyof UserFilterState]);
            if (value === '' || value === undefined || isDefault) next.delete(param);
            else next.set(param, String(value));
          });

          if (!('start' in changes)) next.delete('start');

          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const clear = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);

  const activeCount = [
    filters.customer,
    filters.status,
    filters.department,
    filters.service,
    filters.coverage,
    filters.portal,
  ].filter(Boolean).length;

  return { filters, patch, clear, activeCount };
};

export const useUserFilterOptions = () =>
  useQuery({
    queryKey: userKeys.options(),
    queryFn: ({ signal }) => internal.getUserFilterOptions(signal),
    staleTime: 5 * 60 * 1000,
  });

export const useUserStats = (params: internal.UserListParams = {}) =>
  useQuery({
    queryKey: [...userKeys.stats(), params] as const,
    queryFn: ({ signal }) => internal.getUserStats(params, signal),
    staleTime: 60 * 1000,
  });

export const useUserList = (filters: UserFilterState) => {
  const debouncedSearch = useDebouncedValue(filters.search);

  const params: internal.UserListParams = {
    search: debouncedSearch || undefined,
    customer: filters.customer || undefined,
    status: filters.status || undefined,
    department: filters.department || undefined,
    service: filters.service || undefined,
    coverage: filters.coverage || undefined,
    portal: filters.portal || undefined,
    start: filters.start,
    page_length: filters.pageLength,
  };

  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) => internal.listUsers(params, signal),
    keepPreviousData: true,
  });
};

export const useUserDetail = (name?: string) =>
  useQuery({
    queryKey: userKeys.detail(name || ''),
    queryFn: ({ signal }) => internal.getUser(name as string, signal),
    enabled: Boolean(name),
  });

const useUserMutation = <TVariables>(
  clientUser: string,
  mutationFn: (variables: TVariables) => Promise<internal.UserDetail>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      queryClient.setQueryData(userKeys.detail(clientUser), detail);
      queryClient.invalidateQueries({ queryKey: [...userKeys.all, 'list'] });
      queryClient.invalidateQueries({ queryKey: userKeys.stats() });
      queryClient.invalidateQueries({ queryKey: ['internal', 'dashboard'] });
      // a service change moves the machine's row too, wherever it is being watched from
      queryClient.invalidateQueries({ queryKey: ['internal', 'devices'] });
    },
  });
};

export const useAssignService = (clientUser: string) =>
  useUserMutation(clientUser, internal.assignUserService);

export const useChangeService = (clientUser: string) =>
  useUserMutation(clientUser, internal.changeUserService);

export const useAddDevice = (clientUser: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.addUserDevice,
    onSuccess: (detail) => {
      queryClient.setQueryData(userKeys.detail(clientUser), detail);
      queryClient.invalidateQueries({ queryKey: [...userKeys.all, 'list'] });
      queryClient.invalidateQueries({ queryKey: userKeys.stats() });
    },
  });
};

export const useUpdateClientUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.updateClientUser,
    onSuccess: (detail) => {
      queryClient.setQueryData(userKeys.detail(detail.user.name), detail);
      queryClient.invalidateQueries({ queryKey: [...userKeys.all, 'list'] });
    },
  });
};

const usePortalAccessMutation = <TVariables>(
  mutationFn: (variables: TVariables) => Promise<internal.UserDetail>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      queryClient.setQueryData(userKeys.detail(detail.user.name), detail);
      queryClient.invalidateQueries({ queryKey: [...userKeys.all, 'list'] });
    },
  });
};

export const useInviteToPortal = () =>
  usePortalAccessMutation(internal.inviteClientUserToPortal);

export const useRevokePortalAccess = () =>
  usePortalAccessMutation((name: string) => internal.revokeClientUserPortal(name));
