import React from 'react';
import {
  AtSign,
  Briefcase,
  Building2,
  CalendarDays,
  Inbox,
  Laptop,
  Layers,
  Mail,
  Pencil,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import type { UserDetail } from '@/lib/api/internal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

type Props = {
  detail: UserDetail;
  isAdmin: boolean;
  /** what the customer sees: the same card, with nothing to act on */
  actions?: React.ReactNode;
  readOnly?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: () => void;
};

// DeployOps secondary button: white, hairline ring, fully rounded
const secondary =
  'inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900';

/** One fact about the person, with the icon that says what kind of fact it is. */
const Fact = ({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5">
    <Icon size={14} className="shrink-0 text-slate-400" strokeWidth={1.75} />
    <span className="truncate">{children}</span>
  </span>
);

/** A count from the summary, in the dashboard's stat tile shape but sized for a card. */
const Stat = ({
  icon: Icon,
  label,
  value,
  tile,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tile: string;
}) => (
  <div className="flex items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
    <span className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${tile}`}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <p className="text-xl font-semibold leading-tight tabular-nums text-slate-900">{value}</p>
      <p className="truncate text-[13px] text-slate-500">{label}</p>
    </div>
  </div>
);

/** Who this is, at a glance, and the one thing anybody normally comes here to start. */
const UserIdentityCard: React.FC<Props> = ({
  detail,
  isAdmin,
  onEdit,
  onDelete,
  onStatus,
  actions,
  readOnly = false,
}) => {
  const { user, summary } = detail;
  const archived = user.lifecycle_status === 'Archived';
  const disabled = user.lifecycle_status === 'Disabled';

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className={`grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold ring-1 ${
              disabled || archived
                ? 'bg-slate-100 text-slate-500 ring-slate-200'
                : 'bg-blue-50 text-blue-700 ring-blue-100'
            }`}
          >
            {initials(user.full_name)}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{user.full_name}</h1>
              <StatusBadge value={user.lifecycle_status} />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-600">
              <Fact icon={Briefcase}>{user.department || 'No department'}</Fact>
              <Fact icon={Building2}>{user.customer}</Fact>
              {user.email && <Fact icon={Mail}>{user.email}</Fact>}
              {user.username && <Fact icon={AtSign}>{user.username}</Fact>}
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
              <CalendarDays size={14} className="text-slate-400" strokeWidth={1.75} />
              In service since {fmtDate(user.start_date)}
              {user.disabled_date && <span>· disabled {fmtDate(user.disabled_date)}</span>}
              {user.disabled_reason && <span>({user.disabled_reason})</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          {actions}
          {!readOnly && (
            <button type="button" onClick={onEdit} className={secondary}>
              <Pencil size={14} />
              Edit
            </button>
          )}
          {!readOnly && !archived && (
            <button type="button" onClick={onStatus} className={secondary}>
              {disabled ? <UserCheck size={14} /> : <UserX size={14} />}
              {disabled ? 'Reactivate' : 'Disable'}
            </button>
          )}
          {!readOnly && isAdmin && (
            <button
              type="button"
              onClick={onDelete}
              disabled={!detail.can_delete}
              title={
                detail.can_delete
                  ? 'Erase this person'
                  : `Cannot be deleted: ${(detail.delete_blockers ?? []).join(', ')}`
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:ring-slate-200 disabled:hover:bg-white"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 lg:grid-cols-4">
        <Stat icon={Laptop} label="Devices held" value={summary.current_devices} tile="bg-violet-50 text-violet-600 ring-violet-100" />
        <Stat icon={Layers} label="Personal services" value={summary.active_personal_services} tile="bg-blue-50 text-blue-600 ring-blue-100" />
        <Stat icon={ShieldCheck} label="Device services" value={summary.active_device_services} tile="bg-teal-50 text-teal-600 ring-teal-100" />
        <Stat icon={Inbox} label="Requests in progress" value={summary.open_requests} tile="bg-amber-50 text-amber-600 ring-amber-100" />
      </div>

      {archived && (
        <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200/70">
          Archived users cannot receive new services or devices.
        </p>
      )}
    </section>
  );
};

export default UserIdentityCard;
