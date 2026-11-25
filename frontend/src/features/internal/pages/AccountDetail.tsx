import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  History,
  KeyRound,
  LockKeyhole,
  Monitor,
  ShieldCheck,
  UserCheck,
  UserRound,
  UserX,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Avatar from '@/shared/components/Avatar';
import ConfirmModal from '@/shared/components/ConfirmModal';
import PersonRightsPanel from '../components/PersonRightsPanel';
import AccessReferencesPanel from '../components/AccessReferencesPanel';
import { useSession } from '@/shared/hooks/useSession';
import {
  useResendTeamInvitation,
  useResetTwoFactor,
  useSetTeamEnabled,
  useSetTeamRole,
  useTeamMember,
  useTeamOptions,
} from '../hooks/useTeam';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'Never');

const fmtMoment = (value?: string | null) =>
  value ? String(value).slice(0, 16).replace('T', ' ') : 'Never';

// keyed on what the server calls each role, so a renamed role shows up here rather than
// falling silently through to the "no role" badge
const KIND_STYLE: Record<string, { icon: typeof ShieldCheck; className: string }> = {
  Administrator: { icon: ShieldCheck, className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  Technician: { icon: Wrench, className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  'Customer Manager': { icon: Building2, className: 'bg-slate-50 text-slate-700 ring-slate-200' },
  'Customer Operator': { icon: Building2, className: 'bg-slate-50 text-slate-700 ring-slate-200' },
  'No role': { icon: UserX, className: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

// DeployOps panel, as on the dashboard: title, optional count chip and one muted line
const Panel = ({
  title,
  count,
  description,
  action,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          {title}
          {count !== undefined && (
            <>
              <span className="sr-only"> · </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                {count}
              </span>
            </>
          )}
        </h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
    <div className="max-h-[26rem] overflow-auto pb-2">{children}</div>
  </section>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap border-b border-slate-200 bg-white px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">
    {children}
  </th>
);

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

/** One fact about the account, in the dashboard's soft tile with the icon that names it. */
const Fact = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}) => (
  <div className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className="truncate text-sm font-medium text-slate-900">{value}</p>
    </div>
  </div>
);

// DeployOps secondary button: white, hairline ring, fully rounded
const ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white';

/** What each role opens — the old one always closes behind it. */
const ROLE_CHANGE: Record<string, { title: string; gains: string }> = {
  'MSP System Admin': {
    title: 'Make them an MSP System administrator?',
    gains: 'They will reach billing, contracts, settings and the Frappe desk.',
  },
  'MSP Technician': {
    title: 'Make them a MSP Technician?',
    gains: 'They will handle requests, people and devices, without billing, contracts or settings.',
  },
  'MSP Customer Manager': {
    title: 'Make them a MSP Customer Manager?',
    gains: 'They will use the customer portal for their company, invoices included.',
  },
  'MSP Customer Operator': {
    title: 'Make them a MSP Customer Operator?',
    gains: 'They will use the customer portal for their company, without the invoices.',
  },
};

export default function AccountDetail() {
  const { email = '' } = useParams();
  const address = decodeURIComponent(email);
  const navigate = useNavigate();
  const session = useSession();

  const detail = useTeamMember(address);
  const options = useTeamOptions();
  const setRole = useSetTeamRole();
  const setEnabled = useSetTeamEnabled();
  const resend = useResendTeamInvitation();
  const resetTotp = useResetTwoFactor();

  const [promoting, setPromoting] = useState<string | null>(null);
  const [roleMenu, setRoleMenu] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [resettingTotp, setResettingTotp] = useState(false);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="px-6 pb-6 pt-5">
        <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-100">
          {(detail.error as Error)?.message || 'Account not found.'}
        </div>
      </div>
    );
  }

  const account = detail.data;
  const kind = KIND_STYLE[account.kind] ?? KIND_STYLE['No role'];
  const KindIcon = kind.icon;
  const isSelf = account.name === session.data?.user;
  const isRoot = account.name === 'Administrator';
  // the readable names come with the options, so a renamed role is never shown raw
  const labels = options.data?.labels ?? {};
  const otherRoles = (options.data?.roles ?? []).filter((role) => role !== account.role);

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <button
        type="button"
        onClick={() => navigate('/msp/accounts')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to accounts
      </button>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={account.full_name || account.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {account.full_name || account.name}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${kind.className}`}
                >
                  <KindIcon size={12} />
                  {account.kind}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    account.enabled
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : 'bg-red-50 text-red-700 ring-red-200'
                  }`}
                >
                  {account.enabled ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {account.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">{account.name}</p>
            </div>
          </div>

          {/* only what can actually be done to this account: an action that could never
              apply is not shown greyed out, it is not shown at all */}
          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            {account.can_invite && account.enabled && (
              <button
                type="button"
                onClick={() => resend.mutate(account.name)}
                disabled={resend.isLoading}
                title="Email a fresh link to set a password"
                className={ACTION_CLASS}
              >
                <KeyRound size={14} />
                {resend.isSuccess ? 'Invitation sent' : 'Send a password link'}
              </button>
            )}

            {account.role && !isRoot && otherRoles.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRoleMenu((open) => !open)}
                  disabled={setRole.isLoading}
                  aria-expanded={roleMenu}
                  title="Move this account to another role"
                  className={ACTION_CLASS}
                >
                  <ShieldCheck size={14} />
                  Change role
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${roleMenu ? 'rotate-180' : ''}`}
                  />
                </button>

                {roleMenu && (
                  <>
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      onClick={() => setRoleMenu(false)}
                      className="fixed inset-0 z-10 cursor-default"
                    />
                    <div className="absolute left-0 z-20 mt-1.5 min-w-[16rem] overflow-hidden rounded-2xl bg-white py-1.5 shadow-xl ring-1 ring-slate-200 lg:left-auto lg:right-0">
                      {otherRoles.map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => {
                            setRoleMenu(false);
                            setPromoting(role);
                          }}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <ShieldCheck size={15} className="text-slate-400" />
                          Make {labels[role] ?? role}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {!isSelf && !isRoot && (
              <button
                type="button"
                onClick={() => setSwitching(true)}
                disabled={setEnabled.isLoading}
                title={
                  account.enabled
                    ? 'Take this access away, keeping the account and its trail'
                    : 'Give this access back'
                }
                className={
                  account.enabled
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:ring-slate-200 disabled:hover:bg-white'
                    : ACTION_CLASS
                }
              >
                {account.enabled ? <UserX size={14} /> : <UserCheck size={14} />}
                {account.enabled ? 'Disable access' : 'Enable access'}
              </button>
            )}

            {account.two_factor && (
              <button
                type="button"
                onClick={() => setResettingTotp(true)}
                disabled={resetTotp.isLoading}
                title="Their authenticator stops working and they enrol again"
                className={ACTION_CLASS}
              >
                <KeyRound size={14} />
                Reset two-factor
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Fact icon={ShieldCheck} label="Role" value={account.role || 'None'} />
          <Fact icon={UserRound} label="Account type" value={account.user_type} />
          <Fact
            icon={Monitor}
            label="Frappe desk"
            value={account.desk_access ? 'Allowed' : 'Blocked'}
          />
          <Fact
            icon={LockKeyhole}
            label="Two-factor"
            value={
              account.two_factor ? (
                <span className="text-emerald-600">On</span>
              ) : (
                <span className="text-amber-600">Not set up</span>
              )
            }
          />
          <Fact icon={CalendarDays} label="Created on" value={fmtDate(account.creation)} />
          <Fact icon={History} label="Last sign-in" value={fmtMoment(account.last_login)} />
          <Fact icon={Clock} label="Last seen" value={fmtMoment(account.last_active)} />
          <Fact
            icon={KeyRound}
            label="Password last set"
            value={fmtDate(account.last_password_reset_date)}
          />
          <Fact
            icon={Eye}
            label="Sees"
            value={
              account.customers.length > 0
                ? account.customers.join(', ')
                : account.roles.some((role) => role.startsWith('MSP Customer'))
                  ? 'Nothing — no customer linked'
                  : 'Every customer'
            }
          />
        </div>
      </section>

      <AccessReferencesPanel
        email={account.name}
        access={account.access}
        abilities={account.abilities}
      />

      <PersonRightsPanel user={account.name} />

      <Panel
        title="Recent sign-ins"
        count={account.sign_ins.length}
        description="The latest attempts to sign in to this account, and where they came from."
      >
        {account.sign_ins.length > 0 ? (
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <tr>
                {['When', 'Event', 'Result', 'From'].map((label) => (
                  <Th key={label}>{label}</Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {account.sign_ins.map((row, index) => (
                <tr key={`${row.creation}-${index}`} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-700`}>
                    {fmtMoment(row.creation)}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {row.operation}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm`}>
                    {row.status === 'Success' ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                        {row.status}
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                        {row.status}
                      </span>
                    )}
                  </td>
                  <td className={`whitespace-nowrap ${td} font-mono text-xs text-slate-500`}>
                    {row.ip_address || 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex items-center justify-center gap-3 px-4 py-10 text-sm text-slate-500">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
              <History className="size-[18px]" strokeWidth={1.75} />
            </span>
            <span>This account has never signed in.</span>
          </div>
        )}
      </Panel>

      <ConfirmModal
        open={Boolean(promoting)}
        tone="warning"
        title={ROLE_CHANGE[promoting ?? '']?.title ?? 'Change their role?'}
        description={`${ROLE_CHANGE[promoting ?? '']?.gains ?? ''} Their current role is taken away: an account holds one role only.`}
        confirmLabel="Change the role"
        loading={setRole.isLoading}
        onCancel={() => setPromoting(null)}
        onConfirm={async () => {
          await setRole.mutateAsync({ email: account.name, role: promoting as string });
          setPromoting(null);
        }}
      />

      <ConfirmModal
        open={resettingTotp}
        tone="danger"
        title="Reset two-factor authentication?"
        description="Their authenticator stops working and every session they have open is closed. They set it up again the next time they sign in — do this only once you are sure who you are talking to."
        confirmLabel="Reset"
        loading={resetTotp.isLoading}
        onCancel={() => setResettingTotp(false)}
        onConfirm={async () => {
          await resetTotp.mutateAsync(account.name);
          setResettingTotp(false);
        }}
      />

      <ConfirmModal
        open={switching}
        tone={account.enabled ? 'danger' : 'info'}
        title={account.enabled ? 'Disable this access?' : 'Enable this access?'}
        description={
          account.enabled
            ? 'They will no longer be able to sign in. The account and everything it did are kept.'
            : 'They will be able to sign in again with their existing password.'
        }
        confirmLabel={account.enabled ? 'Disable' : 'Enable'}
        loading={setEnabled.isLoading}
        onCancel={() => setSwitching(false)}
        onConfirm={async () => {
          await setEnabled.mutateAsync({ email: account.name, enabled: account.enabled ? 0 : 1 });
          setSwitching(false);
        }}
      />
    </div>
  );
}
