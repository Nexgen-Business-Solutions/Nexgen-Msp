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
  templates: () => [...notificationKeys.all, 'templates'] as const,
  template: (templateName: string, locale: string) =>
    [...notificationKeys.all, 'template', templateName, locale] as const,
  templatePreview: (templateName: string, locale: string, source: string) =>
    [...notificationKeys.all, 'templatePreview', templateName, locale, source] as const,
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

export const useNotificationTemplates = (enabled = true) =>
  useQuery({
    queryKey: notificationKeys.templates(),
    queryFn: ({ signal }) => internal.getNotificationTemplates(signal),
    enabled,
  });

export const useNotificationTemplate = (
  templateName: string | null,
  locale: internal.NotificationLocale
) =>
  useQuery({
    queryKey: notificationKeys.template(templateName ?? '', locale),
    queryFn: ({ signal }) =>
      internal.getNotificationTemplate(templateName as string, locale, signal),
    enabled: Boolean(templateName),
    cacheTime: 0,
  });

export const useNotificationTemplatePreview = (
  templateName: string | null,
  locale: internal.NotificationLocale,
  source: 'draft' | 'published',
  enabled: boolean
) =>
  useQuery({
    queryKey: notificationKeys.templatePreview(templateName ?? '', locale, source),
    queryFn: ({ signal }) =>
      internal.previewNotificationTemplate(templateName as string, locale, source, signal),
    enabled: Boolean(templateName) && enabled,
    cacheTime: 0,
    retry: false,
  });

/** Every write to a template refreshes the same three things, so they share one hook. */
const useTemplateWrite = <TVariables extends { template_name: string; locale: internal.NotificationLocale }>(
  mutationFn: (variables: TVariables) => Promise<internal.NotificationTemplateDetail>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (detail, variables) => {
      queryClient.setQueryData(
        notificationKeys.template(variables.template_name, variables.locale),
        detail
      );
      queryClient.invalidateQueries({ queryKey: notificationKeys.templates() });
      queryClient.invalidateQueries({
        queryKey: [...notificationKeys.all, 'templatePreview', variables.template_name],
      });
    },
  });
};

export const useSaveNotificationTemplateDraft = () =>
  useTemplateWrite(internal.saveNotificationTemplateDraft);

export const usePublishNotificationTemplate = () =>
  useTemplateWrite(internal.publishNotificationTemplate);

export const useRestoreNotificationTemplate = () =>
  useTemplateWrite(internal.restoreNotificationTemplate);

export const useTestNotificationTemplate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: internal.testNotificationTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...notificationKeys.all, 'history'] }),
  });
};
