import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const settingsKeys = {
  all: ['internal', 'settings'] as const,
  options: () => [...settingsKeys.all, 'options'] as const,
  actions: () => [...settingsKeys.all, 'requestActions'] as const,
};

export const useSettingsOptions = () =>
  useQuery({
    queryKey: settingsKeys.options(),
    queryFn: ({ signal }) => internal.getSettingsOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useRequestActionList = () =>
  useQuery({
    queryKey: settingsKeys.actions(),
    queryFn: ({ signal }) => internal.listRequestActions(signal),
  });

const useActionMutation = <TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (rows) => {
      queryClient.setQueryData(settingsKeys.actions(), rows);
      // the request form reads the same list
      queryClient.invalidateQueries({ queryKey: ['portal'] });
    },
  });
};

export const useSaveRequestAction = () => useActionMutation(internal.saveRequestAction);

export const useDeleteRequestAction = () =>
  useActionMutation((name: string) => internal.deleteRequestAction(name));

export const useInvoiceSettings = () =>
  useQuery({
    queryKey: [...settingsKeys.all, 'invoice'] as const,
    queryFn: ({ signal }) => internal.getInvoiceSettings(signal),
  });

export const useSaveInvoiceSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveInvoiceSettings,
    onSuccess: (data) =>
      queryClient.setQueryData([...settingsKeys.all, 'invoice'], data),
  });
};

export const useImportMappings = () =>
  useQuery({
    queryKey: [...settingsKeys.all, 'import-mappings'] as const,
    queryFn: ({ signal }) => internal.getImportMappings(signal),
  });

export const useSaveImportMappings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveImportMappings,
    onSuccess: (data) =>
      queryClient.setQueryData([...settingsKeys.all, 'import-mappings'], data),
  });
};

export const useRunUserImport = () =>
  useMutation({
    mutationFn: async (variables: {
      file: File;
      dryRun: boolean;
      fillBlanksOnly: boolean;
    }) => {
      const uploaded = await internal.uploadUserList(variables.file);
      return internal.runUserImport(
        uploaded.file_url,
        variables.dryRun ? 1 : 0,
        variables.fillBlanksOnly ? 1 : 0
      );
    },
  });

export const useRunAssetImport = () =>
  useMutation({
    mutationFn: async (variables: {
      file: File;
      dryRun: boolean;
      fillBlanksOnly: boolean;
    }) => {
      const uploaded = await internal.uploadUserList(variables.file);
      const shape = await internal.describeAssetFile(uploaded.file_url);
      const report = await internal.runAssetImport(
        uploaded.file_url,
        variables.dryRun ? 1 : 0,
        variables.fillBlanksOnly ? 1 : 0
      );
      return { shape, report };
    },
  });
