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

/** Whatever changes the catalogue changes what can be chosen, everywhere. */
const useCatalogueMutation = <TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogueKeys.all });
      queryClient.invalidateQueries({ queryKey: ['internal', 'contracts'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['internal', 'devices'] });
      queryClient.invalidateQueries({ queryKey: ['portal'] });
    },
  });
};

export const useCatalogueItemSearch = (search: string, open: boolean) =>
  useQuery({
    queryKey: [...catalogueKeys.all, 'item-search', search] as const,
    queryFn: ({ signal }) => internal.searchCatalogueItems({ search, page_length: 20 }, signal),
    enabled: open,
    keepPreviousData: true,
  });

export const useItemCompatibility = (item?: string) =>
  useQuery({
    queryKey: [...catalogueKeys.all, 'compatibility', item] as const,
    queryFn: ({ signal }) => internal.getItemMspCompatibility(item as string, signal),
    enabled: Boolean(item),
  });

export const useEnableItemForMsp = () => useCatalogueMutation(internal.enableItemForMsp);
export const useCreateMspService = () => useCatalogueMutation(internal.createMspService);
export const useRemoveServiceFromMsp = () => useCatalogueMutation(internal.removeServiceFromMsp);

export const useServiceDetail = (name?: string) =>
  useQuery({
    queryKey: catalogueKeys.detail(name || ''),
    queryFn: ({ signal }) => internal.getService(name as string, signal),
    enabled: Boolean(name),
  });
