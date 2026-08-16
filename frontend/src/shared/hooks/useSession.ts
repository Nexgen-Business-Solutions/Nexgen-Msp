import { useQuery } from '@tanstack/react-query';
import { getSessionContext } from '@/lib/api/session';

export const sessionKeys = {
  context: ['session', 'context'] as const,
};

export const useSession = () =>
  useQuery({
    queryKey: sessionKeys.context,
    queryFn: ({ signal }) => getSessionContext(signal),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
