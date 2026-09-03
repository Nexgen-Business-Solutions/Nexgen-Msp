import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { resetTwoFactor } from '@/lib/api/auth2fa';

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

export const useCreateAccount = () => useTeamMutation(internal.createAccount);
export const useSetTeamRole = () => useTeamMutation(internal.setTeamRole);
export const useSetTeamEnabled = () => useTeamMutation(internal.setTeamEnabled);
export const useResendTeamInvitation = () => useTeamMutation(internal.resendTeamInvitation);

export const useResetTwoFactor = () => useTeamMutation((user: string) => resetTwoFactor(user));

export const useAccountRights = (user?: string) =>
  useQuery({
    queryKey: ['team', 'rights', user] as const,
    queryFn: ({ signal }) => internal.getAccountRights(user as string, signal),
    enabled: Boolean(user),
  });

export const useSetAccountRights = (user: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rights: Record<string, unknown>) => internal.setAccountRights(user, rights),
    onSuccess: (data) => queryClient.setQueryData(['team', 'rights', user], data),
  });
};
