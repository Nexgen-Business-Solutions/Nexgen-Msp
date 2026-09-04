import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, KeyRound, Plus, ShieldCheck, UserCheck, UserX, Wrench } from 'lucide-react';
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

const COLUMNS = ['Account', 'Kind', 'Scope', 'Desk', '2FA', 'Last seen', 'Status', ''];



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

  const setRole = useSetTeamRole();
  const setEnabled = useSetTeamEnabled();
  const resend = useResendTeamInvitation();
  const resetTotp = useResetTwoFactor();

  const rows = useMemo(() => list.data ?? [], [list.data]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      admins: rows.filter((row) => row.kind === 'Administrator').length,
      technicians: rows.filter((row) => row.kind === 'Technician').length,
      portal: rows.filter((row) => row.roles.some((role) => role.startsWith('MSP Customer'))).length,
      disabled: rows.filter((row) => !row.enabled).length,
    }),
    [rows]
  );

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus size={15} />
          Add an account
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={UserCheck} accent="blue" label="Accounts" value={counts.total} caption="Everyone who can sign in" loading={list.isLoading} />
        <KpiCard icon={ShieldCheck} accent="emerald" label="Administrators" value={counts.admins} caption="Billing, contracts and settings" loading={list.isLoading} />
        <KpiCard icon={Wrench} accent="slate" label="Technicians" value={counts.technicians} caption="Requests, people and devices" loading={list.isLoading} />
        <KpiCard icon={Building2} accent="slate" label="Portal contacts" value={counts.portal} caption="Customers signing in to their portal" loading={list.isLoading} />
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

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white pt-4 shadow-sm">
        <div className="max-h-[62vh] overflow-auto px-5 pb-1">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column || index}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
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
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!list.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    No account matches these filters.
                  </td>
                </tr>
              )}

              {rows.map((member) => (
                <tr
                  key={member.name}
                  onClick={() => navigate(`/msp/accounts/${encodeURIComponent(member.name)}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {member.full_name || member.name}
                    </p>
                    <p className="text-xs text-slate-400">{member.name}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {member.kind}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {member.customers.length > 0 ? (
                      member.customers.join(', ')
                    ) : member.roles.some((role) => role.startsWith('MSP Customer')) ? (
                      <span className="text-amber-600">No customer linked</span>
                    ) : (
                      <span className="text-slate-400">All customers</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {member.user_type === 'System User' ? (
                      <span className="text-slate-600">Frappe desk</span>
                    ) : (
                      <span className="text-slate-400">App only</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {member.two_factor ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <ShieldCheck size={13} />
                        On
                      </span>
                    ) : (
                      <span className="text-amber-600">Not set up</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(member.last_active)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                        member.enabled
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
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
