import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const notificationKeys = {
  all: ['internal', 'notifications'] as const,
  overview: (params: internal.NotificationOverviewParams) =>
    [...notificationKeys.all, 'overview', params] as const,
  rule: (ruleKey: string) => [...notificationKeys.all, 'rule', ruleKey] as const,
  preview: (ruleKey: string) => [...notificationKeys.all, 'preview', ruleKey] as const,
  eligibility: (ruleKey: string) => [...notificationKeys.all, 'eligibility', ruleKey] as const,
  history: (params: internal.NotificationHistoryParams) =>
    [...notificationKeys.all, 'history', params] as const,
  evidence: (dispatch: string) => [...notificationKeys.all, 'evidence', dispatch] as const,
  sources: () => [...notificationKeys.all, 'sources'] as const,
};

export const useNotificationOverview = (params: internal.NotificationOverviewParams) =>
  useQuery({
    queryKey: notificationKeys.overview(params),
    queryFn: ({ signal }) => internal.getNotificationOverview(params, signal),
    keepPreviousData: true,
  });

export const useNotificationRule = (ruleKey: string | null) =>
  useQuery({
    queryKey: notificationKeys.rule(ruleKey ?? ''),
    queryFn: ({ signal }) => internal.getNotificationRule(ruleKey as string, signal),
    enabled: Boolean(ruleKey),
    cacheTime: 0,
  });

export const useNotificationPreview = (ruleKey: string | null, enabled: boolean) =>
  useQuery({
    queryKey: notificationKeys.preview(ruleKey ?? ''),
    queryFn: ({ signal }) => internal.previewNotificationRule(ruleKey as string, signal),
    enabled: Boolean(ruleKey) && enabled,
    retry: false,
  });

export const useNotificationEligibility = (ruleKey: string | null, enabled: boolean) =>
  useQuery({
    queryKey: notificationKeys.eligibility(ruleKey ?? ''),
    queryFn: ({ signal }) => internal.getNotificationEligibility(ruleKey as string, 0, signal),
    enabled: Boolean(ruleKey) && enabled,
    retry: false,
  });

export const useNotificationHistory = (params: internal.NotificationHistoryParams, enabled = true) =>
  useQuery({
    queryKey: notificationKeys.history(params),
    queryFn: ({ signal }) => internal.getNotificationHistory(params, signal),
    enabled,
    keepPreviousData: true,
  });

export const useNotificationSources = (enabled = true) =>
  useQuery({
    queryKey: notificationKeys.sources(),
    queryFn: ({ signal }) => internal.getNotificationSources(signal),
    enabled,
  });

export const useSaveNotificationRule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.saveNotificationRule,
    onSuccess: (detail, variables) => {
      queryClient.setQueryData(notificationKeys.rule(variables.rule_key), detail);
      queryClient.invalidateQueries({ queryKey: [...notificationKeys.all, 'overview'] });
      queryClient.invalidateQueries({ queryKey: notificationKeys.preview(variables.rule_key) });
      queryClient.invalidateQueries({ queryKey: notificationKeys.eligibility(variables.rule_key) });
    },
  });
};

export const useTestNotificationRule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.testNotificationRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...notificationKeys.all, 'history'] }),
  });
};

export const useDispatchEvidence = (dispatch: string | null) =>
  useQuery({
    queryKey: notificationKeys.evidence(dispatch ?? ''),
    queryFn: ({ signal }) => internal.getNotificationDispatchEvidence(dispatch as string, signal),
    enabled: Boolean(dispatch),
    cacheTime: 0,
    retry: false,
  });

export const useResolveDispatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.resolveNotificationDispatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...notificationKeys.all, 'history'] }),
  });
};
