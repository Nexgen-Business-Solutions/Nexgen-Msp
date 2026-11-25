import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, KeyRound, Plus, SearchX, ShieldCheck, UserCheck, UserRound, UserX, Wrench } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import ConfirmModal from '@/shared/components/ConfirmModal';
import InviteTeamModal from '../components/InviteTeamModal';
import type { TeamMember } from '@/lib/api/internal';
import {
  useResendTeamInvitation,
  useResetTwoFactor,
  useSetTeamEnabled,
  useSetTeamRole,
  useTeam,
  useTeamOptions,
} from '../hooks/useTeam';

const COLUMNS = ['Account', 'Kind', '2FA', 'Last seen', 'Status', ''];

// the kind of account, drawn beside the name so the register scans at a glance
const KIND_ICON: Record<string, { icon: typeof UserRound; tile: string }> = {
  Administrator: { icon: ShieldCheck, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
  Technician: { icon: Wrench, tile: 'bg-blue-50 text-blue-600 ring-blue-100' },
  Customer: { icon: Building2, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-100' },
};

const KindIcon = ({ kind }: { kind?: string | null }) => {
  const { icon: Icon, tile } = KIND_ICON[kind ?? ''] ?? {
    icon: UserRound,
    tile: 'bg-slate-100 text-slate-600 ring-slate-200',
  };

  return (
    <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full ring-1 ${tile}`}>
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'Never');

export default function TeamList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>({ kind: '', status: '' });
  const [search, setSearch] = useState('');
  const [inviting, setInviting] = useState(false);
  const [target, setTarget] = useState<{
    member: TeamMember;
    action: 'disable' | 'enable' | 'reset2fa';
  } | null>(
    null
  );

  const options = useTeamOptions();
  const labels = options.data?.labels ?? {};
  const list = useTeam({
    search: search || undefined,
    kind: (filters.kind as string) || undefined,
    status: (filters.status as string) || undefined,
  });

  // the cards count everyone; a filter narrows the list below, never them
  const everyone = useTeam({});
  const setRole = useSetTeamRole();
  const setEnabled = useSetTeamEnabled();
  const resend = useResendTeamInvitation();
  const resetTotp = useResetTwoFactor();

  const rows = useMemo(() => list.data ?? [], [list.data]);

  const counts = useMemo(() => {
    const all = everyone.data ?? [];

    return {
      total: all.length,
      admins: all.filter((row) => row.kind === 'Administrator').length,
      technicians: all.filter((row) => row.kind === 'Technician').length,
      portal: all.filter((row) => row.roles.some((role) => role.startsWith('MSP Customer'))).length,
      disabled: all.filter((row) => !row.enabled).length,
    };
  }, [everyone.data]);

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={UserCheck} accent="blue" label="Accounts" value={counts.total} caption="Everyone who can sign in" loading={list.isLoading} onView={() => setFilters({ kind: '', status: '' })} />
        <KpiCard icon={ShieldCheck} accent="emerald" label="Administrators" value={counts.admins} caption="Billing, contracts and settings" loading={list.isLoading} onView={() => setFilters({ kind: 'Administrator', status: '' })} />
        <KpiCard icon={Wrench} accent="slate" label="Technicians" value={counts.technicians} caption="Requests, people and devices" loading={list.isLoading} onView={() => setFilters({ kind: 'Technician', status: '' })} />
        <KpiCard icon={Building2} accent="slate" label="Portal contacts" value={counts.portal} caption="Customers signing in to their portal" loading={list.isLoading} onView={() => setFilters({ kind: 'Customer', status: '' })} />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
        >
          <Plus size={15} />
          Add an account
        </button>
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a name, an email or a customer…"
        subtitle="Every account that can sign in, staff and customer contacts alike."
        onSearch={setSearch}
        onApply={(values) => setFilters({ kind: values.kind ?? '', status: values.status ?? '' })}
        onClear={() => {
          setFilters({ kind: '', status: '' });
          setSearch('');
        }}
        onRefresh={() => list.refetch()}
        fields={[
          {
            key: 'kind',
            label: 'Kind',
            kind: 'select',
            allLabel: 'Any kind',
            options: (options.data?.kinds ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            allLabel: 'Any status',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled' },
            ],
          },
        ]}
      />

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="max-h-[62vh] overflow-auto px-2 pb-1 sm:px-3">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column || index}
                    className="whitespace-nowrap border-b border-slate-200 px-4 pb-3 pt-4 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.error instanceof Error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-red-600">
                    {list.error.message}
                  </td>
                </tr>
              )}

              {list.isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12">
                    <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
                      <span className="size-5 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
                      Loading…
                    </div>
                  </td>
                </tr>
              )}

              {!list.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12">
                    <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                        <SearchX className="size-[18px]" strokeWidth={1.75} />
                      </span>
                      No account matches these filters.
                    </div>
                  </td>
                </tr>
              )}

              {rows.map((member) => (
                <tr
                  key={member.name}
                  onClick={() => navigate(`/msp/accounts/${encodeURIComponent(member.name)}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50/80"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-3">
                      <KindIcon kind={member.kind} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {member.full_name || member.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{member.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    <p className="text-sm font-medium text-slate-800">{member.kind}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{member.customers.join(', ')}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {member.two_factor ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                        <ShieldCheck size={13} />
                        On
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        Not set up
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                    {fmtDate(member.last_active)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                        member.enabled
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                          : 'bg-slate-100 text-slate-500 ring-slate-200'
                      }`}
                    >
                      {member.enabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={
                          [
                            // the menu offers what applies to this account and nothing else
                            ...(member.enabled
                              ? [
                                {
                                  label: 'Resend the invitation',
                                  icon: KeyRound,
                                  onClick: () => resend.mutate(member.name),
                                },
                              ]
                              : []),
                            ...(member.role
                              ? (options.data?.roles ?? [])
                                .filter((role) => role !== member.role)
                                .map((role) => ({
                                  label: `Make ${labels[role] ?? role}`,
                                  icon: ShieldCheck,
                                  onClick: () => setRole.mutate({ email: member.name, role }),
                                }))
                              : []),
                            ...(member.two_factor
                              ? [
                                {
                                  label: 'Reset two-factor',
                                  icon: KeyRound,
                                  onClick: () => setTarget({ member, action: 'reset2fa' }),
                                },
                              ]
                              : []),
                            {
                              label: member.enabled ? 'Disable the account' : 'Enable the account',
                              icon: member.enabled ? UserX : UserCheck,
                              danger: Boolean(member.enabled),
                              onClick: () =>
                                setTarget({
                                  member,
                                  action: member.enabled ? 'disable' : 'enable',
                                }),
                            },
                          ] as RowAction[]
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <InviteTeamModal open={inviting} onClose={() => setInviting(false)} />

      <ConfirmModal
        open={Boolean(target)}
        tone={target?.action === 'enable' ? 'info' : 'danger'}
        title={
          target?.action === 'reset2fa'
            ? `Reset two-factor for ${target?.member.full_name ?? ''}?`
            : target?.action === 'disable'
              ? `Disable ${target?.member.full_name ?? ''}?`
              : `Enable ${target?.member.full_name ?? ''}?`
        }
        description={
          target?.action === 'reset2fa'
            ? 'Their authenticator stops working and their sessions are closed. They set it up again the next time they sign in — do this only once you are sure who you are talking to.'
            : target?.action === 'disable'
              ? 'They can no longer sign in. Nothing they did is removed.'
              : 'They can sign in again with their existing password.'
        }
        confirmLabel={
          target?.action === 'reset2fa'
            ? 'Reset'
            : target?.action === 'disable'
              ? 'Disable'
              : 'Enable'
        }
        loading={setEnabled.isLoading || resetTotp.isLoading}
        onCancel={() => setTarget(null)}
        onConfirm={async () => {
          if (target!.action === 'reset2fa') {
            await resetTotp.mutateAsync(target!.member.name);
          } else {
            await setEnabled.mutateAsync({
              email: target!.member.name,
              enabled: target!.action === 'enable' ? 1 : 0,
            });
          }
          setTarget(null);
        }}
      />
    </div>
  );
}
