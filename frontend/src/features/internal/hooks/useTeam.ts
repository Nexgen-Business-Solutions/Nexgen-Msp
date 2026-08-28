import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';

export const teamKeys = {
  all: ['internal', 'team'] as const,
  list: (params: Record<string, unknown>) => [...teamKeys.all, 'list', params] as const,
  options: () => [...teamKeys.all, 'options'] as const,
  detail: (email: string) => [...teamKeys.all, 'detail', email] as const,
};

export const useTeam = (
  params: { search?: string; role?: string; status?: string; kind?: string } = {}
) =>
  useQuery({
    queryKey: teamKeys.list(params),
    queryFn: ({ signal }) => internal.listTeam(params, signal),
    keepPreviousData: true,
  });

export const useTeamMember = (email: string) =>
  useQuery({
    queryKey: teamKeys.detail(email),
    queryFn: ({ signal }) => internal.getTeamMember(email, signal),
    enabled: Boolean(email),
  });

export const useTeamOptions = () =>
  useQuery({
    queryKey: teamKeys.options(),
    queryFn: ({ signal }) => internal.getTeamOptions(signal),
    staleTime: 10 * 60 * 1000,
  });

const useTeamMutation = <TVariables>(fn: (variables: TVariables) => Promise<unknown>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
};

export const useInviteTeamMember = () => useTeamMutation(internal.inviteTeamMember);
export const useSetTeamRole = () => useTeamMutation(internal.setTeamRole);
export const useSetTeamEnabled = () => useTeamMutation(internal.setTeamEnabled);
export const useResendTeamInvitation = () => useTeamMutation(internal.resendTeamInvitation);
