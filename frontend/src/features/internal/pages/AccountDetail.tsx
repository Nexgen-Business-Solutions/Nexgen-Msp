import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  UserCheck,
  UserX,
  Wrench,
  XCircle,
} from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
import PersonRightsPanel from '../components/PersonRightsPanel';
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

const KIND_STYLE: Record<string, { icon: typeof ShieldCheck; className: string }> = {
  Administrator: { icon: ShieldCheck, className: 'bg-emerald-50 text-emerald-700' },
  Technician: { icon: Wrench, className: 'bg-blue-50 text-blue-700' },
  'Portal contact': { icon: Building2, className: 'bg-slate-100 text-slate-700' },
  'No role': { icon: UserX, className: 'bg-amber-50 text-amber-700' },
};

const Panel = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {action}
    </div>
    <div className="max-h-[26rem] overflow-auto px-5 pb-4">{children}</div>
  </div>
);

const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-xs font-medium text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm text-slate-700">{value}</p>
  </div>
);

const ROLE_LABEL: Record<string, string> = {
  'MSP System Admin': 'administrator',
  'MSP Operator': 'operator',
  'MSP Technician': 'technician',
};

const ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400';

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
  const [switching, setSwitching] = useState(false);
  const [resettingTotp, setResettingTotp] = useState(false);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
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
  const otherRoles = (options.data?.roles ?? []).filter((role) => role !== account.role);

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/accounts')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to accounts
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">
              {account.full_name || account.name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">{account.name}</p>
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${kind.className}`}
          >
            <KindIcon size={13} />
            {account.kind}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              account.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {account.enabled ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {account.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>

        {/* only what can actually be done to this account: an action that could never
            apply is not shown greyed out, it is not shown at all */}
        <div className="mt-4 flex flex-wrap gap-2.5">
          {account.can_invite && account.enabled && (
            <button
              type="button"
              onClick={() => resend.mutate(account.name)}
              disabled={resend.isLoading}
              title="Email a fresh link to set a password"
              className={ACTION_CLASS}
            >
              <KeyRound size={15} />
              {resend.isSuccess ? 'Invitation sent' : 'Send a password link'}
            </button>
          )}

          {account.role &&
            !isRoot &&
            otherRoles.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setPromoting(role)}
                disabled={setRole.isLoading}
                title={`Move this account to ${role}`}
                className={ACTION_CLASS}
              >
                <ShieldCheck size={15} />
                Make {ROLE_LABEL[role] ?? role}
              </button>
            ))}

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
                  ? 'inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400'
                  : ACTION_CLASS
              }
            >
              {account.enabled ? <UserX size={15} /> : <UserCheck size={15} />}
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
              <KeyRound size={15} />
              Reset two-factor
            </button>
          )}

          {account.client_user && (
            <button
              type="button"
              onClick={() => navigate(`/msp/users/${account.client_user!.name}`)}
              className={ACTION_CLASS}
            >
              <Building2 size={15} />
              Open their file
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Fact label="Role" value={account.role || 'None'} />
          <Fact label="Account type" value={account.user_type} />
          <Fact label="Frappe desk" value={account.desk_access ? 'Allowed' : 'Blocked'} />
          <Fact
            label="Two-factor"
            value={
              account.two_factor ? (
                <span className="text-emerald-600">On</span>
              ) : (
                <span className="text-amber-600">Not set up</span>
              )
            }
          />
          <Fact label="Created on" value={fmtDate(account.creation)} />
          <Fact label="Last sign-in" value={fmtMoment(account.last_login)} />
          <Fact label="Last seen" value={fmtMoment(account.last_active)} />
          <Fact
            label="Password last set"
            value={fmtDate(account.last_password_reset_date)}
          />
          <Fact
            label="Sees"
            value={
              account.customers.length > 0
                ? account.customers.join(', ')
                : account.kind === 'Portal contact'
                  ? 'Nothing — no customer linked'
                  : 'Every customer'
            }
          />
        </div>
      </div>

      {account.client_user && <PersonRightsPanel clientUser={account.client_user.name} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Person on file">
          {account.client_user ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 pt-1">
              <Fact
                label="Name"
                value={
                  <button
                    type="button"
                    onClick={() => navigate(`/msp/users/${account.client_user!.name}`)}
                    className="font-medium text-blue-600 transition-colors hover:text-blue-700"
                  >
                    {account.client_user.full_name || account.client_user.name}
                  </button>
                }
              />
              <Fact label="Customer" value={account.client_user.customer || 'N/A'} />
              <Fact label="Status" value={account.client_user.lifecycle_status || 'N/A'} />
              <Fact label="Email on file" value={account.client_user.email || 'N/A'} />
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              {account.role
                ? 'Staff accounts are not attached to a customer file.'
                : 'This account is not attached to anyone. It should either be given a role or removed.'}
            </p>
          )}
        </Panel>

        <Panel title="Recent sign-ins">
          {account.sign_ins.length > 0 ? (
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  {['When', 'Event', 'Result', 'From'].map((label) => (
                    <th
                      key={label}
                      className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:rounded-l-lg last:rounded-r-lg"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {account.sign_ins.map((row, index) => (
                  <tr key={`${row.creation}-${index}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                      {fmtMoment(row.creation)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.operation}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={
                          row.status === 'Success' ? 'text-slate-600' : 'font-medium text-red-600'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                      {row.ip_address || 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              This account has never signed in.
            </p>
          )}
        </Panel>
      </div>

      <ConfirmModal
        open={Boolean(promoting)}
        tone="warning"
        title={
          promoting === 'MSP System Admin' ? 'Make them an administrator?' : 'Make them a technician?'
        }
        description={
          promoting === 'MSP System Admin'
            ? 'They will reach billing, contracts and settings, and the Frappe desk.'
            : 'They keep requests, people and devices, and lose billing, contracts and settings.'
        }
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
