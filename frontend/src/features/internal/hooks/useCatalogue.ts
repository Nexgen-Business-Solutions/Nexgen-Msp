import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const catalogueKeys = {
  all: ['internal', 'catalogue'] as const,
  options: () => [...catalogueKeys.all, 'options'] as const,
  list: () => [...catalogueKeys.all, 'list'] as const,
};

export const useCatalogueOptions = () =>
  useQuery({
    queryKey: catalogueKeys.options(),
    queryFn: ({ signal }) => internal.getCatalogueOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useServiceCatalogue = () =>
  useQuery({
    queryKey: catalogueKeys.list(),
    queryFn: ({ signal }) => internal.listServices(signal),
    staleTime: 60 * 1000,
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
