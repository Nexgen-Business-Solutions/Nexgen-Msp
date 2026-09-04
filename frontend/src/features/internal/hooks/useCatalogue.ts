import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const catalogueKeys = {
  all: ['internal', 'catalogue'] as const,
  options: () => [...catalogueKeys.all, 'options'] as const,
  list: () => [...catalogueKeys.all, 'list'] as const,
  detail: (name: string) => [...catalogueKeys.all, 'detail', name] as const,
};

export const useCatalogueOptions = () =>
  useQuery({
    queryKey: catalogueKeys.options(),
    queryFn: ({ signal }) => internal.getCatalogueOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useServiceCatalogue = (params: internal.ServiceListParams = {}) =>
  useQuery({
    queryKey: [...catalogueKeys.list(), params] as const,
    queryFn: ({ signal }) => internal.listServices(params, signal),
    staleTime: 60 * 1000,
    keepPreviousData: true,
  });

export const useSaveService = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveService,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogueKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'contracts'] });
    },
  });
};

export const useServiceDetail = (name?: string) =>
  useQuery({
    queryKey: catalogueKeys.detail(name || ''),
    queryFn: ({ signal }) => internal.getService(name as string, signal),
    enabled: Boolean(name),
  });
