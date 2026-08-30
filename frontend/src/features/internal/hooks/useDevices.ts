import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

export const deviceKeys = {
  all: ['internal', 'devices'] as const,
  options: () => [...deviceKeys.all, 'options'] as const,
  stats: () => [...deviceKeys.all, 'stats'] as const,
  list: (params: internal.DeviceListParams) => [...deviceKeys.all, 'list', params] as const,
  context: (device: string) => [...deviceKeys.all, 'context', device] as const,
  detail: (device: string) => [...deviceKeys.all, 'detail', device] as const,
};

export type DeviceFilterState = {
  search: string;
  customer: string;
  status: string;
  device_type: string;
  coverage: string;
  start: number;
  pageLength: number;
};

const DEFAULTS: DeviceFilterState = {
  search: '',
  customer: '',
  status: '',
  device_type: '',
  coverage: '',
  start: 0,
  pageLength: 20,
};

const PARAMS: Record<string, string> = {
  search: 'q',
  customer: 'customer',
  status: 'status',
  device_type: 'type',
  coverage: 'coverage',
  start: 'start',
  pageLength: 'rows',
};

export const useDeviceFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: DeviceFilterState = useMemo(
    () => ({
      search: searchParams.get('q') ?? DEFAULTS.search,
      customer: searchParams.get('customer') ?? DEFAULTS.customer,
      status: searchParams.get('status') ?? DEFAULTS.status,
      device_type: searchParams.get('type') ?? DEFAULTS.device_type,
      coverage: searchParams.get('coverage') ?? DEFAULTS.coverage,
      start: Number(searchParams.get('start') ?? DEFAULTS.start),
      pageLength: Number(searchParams.get('rows') ?? DEFAULTS.pageLength),
    }),
    [searchParams]
  );

  const patch = useCallback(
    (changes: Partial<DeviceFilterState>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(changes).forEach(([key, value]) => {
            const param = PARAMS[key];
            if (!param) return;
            const isDefault = String(value) === String(DEFAULTS[key as keyof DeviceFilterState]);
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
    filters.device_type,
    filters.coverage,
  ].filter(Boolean).length;

  return { filters, patch, clear, activeCount };
};

export const useDeviceFilterOptions = () =>
  useQuery({
    queryKey: deviceKeys.options(),
    queryFn: ({ signal }) => internal.getDeviceFilterOptions(signal),
    staleTime: 5 * 60 * 1000,
  });

export const useDeviceStats = (params: internal.DeviceListParams = {}) =>
  useQuery({
    queryKey: [...deviceKeys.stats(), params] as const,
    queryFn: ({ signal }) => internal.getDeviceStats(params, signal),
    staleTime: 60 * 1000,
  });

export const useDeviceList = (filters: DeviceFilterState) => {
  const debouncedSearch = useDebouncedValue(filters.search);

  const params: internal.DeviceListParams = {
    search: debouncedSearch || undefined,
    customer: filters.customer || undefined,
    status: filters.status || undefined,
    device_type: filters.device_type || undefined,
    coverage: filters.coverage || undefined,
    start: filters.start,
    page_length: filters.pageLength,
  };

  return useQuery({
    queryKey: deviceKeys.list(params),
    queryFn: ({ signal }) => internal.listManagedDevices(params, signal),
    keepPreviousData: true,
  });
};

export const useDeviceContext = (device?: string | null) =>
  useQuery({
    queryKey: deviceKeys.context(device || ''),
    queryFn: ({ signal }) => internal.getDeviceContext(device as string, signal),
    enabled: Boolean(device),
    staleTime: 0,
  });

export const useAssignDeviceService = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.assignDeviceService,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'dashboard'] });
    },
  });
};

const useDeviceMutation = <TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'dashboard'] });
    },
  });
};

export const useUpdateDevice = () => useDeviceMutation(internal.updateManagedDevice);

export const useChangeDeviceStatus = () => useDeviceMutation(internal.changeDeviceStatus);

export const useHandOverDevice = () => useDeviceMutation(internal.handOverDevice);

export const useCustomerDevices = (customer?: string | null, excludeHolder?: string) =>
  useQuery({
    queryKey: [...deviceKeys.all, 'customerDevices', customer, excludeHolder] as const,
    queryFn: ({ signal }) =>
      internal.listCustomerDevices(
        { customer: customer as string, exclude_holder: excludeHolder },
        signal
      ),
    enabled: Boolean(customer),
    staleTime: 30 * 1000,
  });

export const useSerialMatch = (serial?: string, exclude?: string) =>
  useQuery({
    queryKey: [...deviceKeys.all, 'serial', serial, exclude] as const,
    queryFn: ({ signal }) =>
      internal.findDeviceSerial({ serial_number: serial as string, exclude }, signal),
    enabled: (serial ?? '').trim().length > 1,
    staleTime: 10 * 1000,
  });

export const useHostnameMatch = (customer?: string | null, hostname?: string) =>
  useQuery({
    queryKey: [...deviceKeys.all, 'hostname', customer, hostname] as const,
    queryFn: ({ signal }) =>
      internal.findDeviceHostname({ customer: customer as string, hostname: hostname as string }, signal),
    enabled: Boolean(customer) && (hostname ?? '').trim().length > 1,
    staleTime: 10 * 1000,
  });

export const useCustomerUsers = (customer?: string | null) =>
  useQuery({
    queryKey: [...deviceKeys.all, 'customerUsers', customer] as const,
    queryFn: ({ signal }) => internal.listCustomerUsers(customer as string, signal),
    enabled: Boolean(customer),
    staleTime: 60 * 1000,
  });

export const useCreateDevice = () => useDeviceMutation(internal.createManagedDevice);

export const useDeviceDetail = (device?: string) =>
  useQuery({
    queryKey: deviceKeys.detail(device || ''),
    queryFn: ({ signal }) => internal.getDevice(device as string, signal),
    enabled: Boolean(device),
  });

export const useDeleteDevice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.deleteDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
    },
  });
};
