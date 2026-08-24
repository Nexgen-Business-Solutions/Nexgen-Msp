import { useQuery } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const activityKeys = {
  all: ['internal', 'activity'] as const,
  options: () => [...activityKeys.all, 'options'] as const,
  list: (params: Record<string, unknown>) => [...activityKeys.all, 'list', params] as const,
};

export const useActivityOptions = () =>
  useQuery({
    queryKey: activityKeys.options(),
    queryFn: ({ signal }) => internal.getActivityOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

export const useActivity = (query: internal.ActivityQuery) =>
  useQuery({
    queryKey: activityKeys.list(query as Record<string, unknown>),
    queryFn: ({ signal }) => internal.listActivity(query, signal),
    keepPreviousData: true,
    staleTime: 30 * 1000,
  });
