import React, { useState } from 'react';
import {
  ChevronDown,
  Eye,
  Info,
  ShieldAlert,
  SquarePen,
  Trash2,
  UserCog,
  UserMinus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Avatar from '@/shared/components/Avatar';
import ConfirmModal from '@/shared/components/ConfirmModal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import DecisionMakerDrawer from './DecisionMakerDrawer';
import DecisionMakerModal from './DecisionMakerModal';
import { useCustomerAuthority, useSaveCustomerAuthority } from '../hooks/useContracts';
import type { Approver } from '@/lib/api/internal';

type Props = { customer: string };

const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th
    className={`whitespace-nowrap border-b border-slate-200 bg-white px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6 ${
      right ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

const fmt = (value?: string | null) => (value ? String(value).slice(0, 10) : null);

/** What a line's own state is, in the words the screen uses for it. */
const standing = (row: Approver) => {
  if ((row.status ?? 'Active') === 'Inactive') return { label: 'Stood down', tone: 'slate' };
  if (row.deciding === false && row.effective_to) return { label: 'Ended', tone: 'slate' };
  if (row.deciding === false) return { label: 'Scheduled', tone: 'blue' };

  return { label: 'Deciding', tone: 'emerald' };
};

const TONES: Record<string, string> = {
  slate: 'bg-slate-50 text-slate-600 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

/** The stretch a line was, or will be, in force for. */
const spell = (row: Approver) => {
  const from = fmt(row.effective_from);
  const until = fmt(row.effective_to);

  if (from && until) return `${from} → ${until}`;
  if (from) return `from ${from}`;
  if (until) return `until ${until}`;

  return null;
};

const Pill: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    className={`inline-flex items-center gap-1.5 text-sm font-medium ${
      on ? 'text-emerald-700' : 'text-slate-400'
    }`}
  >
    <span
      aria-hidden
      className={`size-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}
    />
    {on ? 'Yes' : 'No'}
  </span>
);

const Action: React.FC<{ label: string; icon: LucideIcon; onClick: () => void }> = ({
  label,
  icon: Icon,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="grid size-9 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-800"
  >
    <Icon size={15} />
  </button>
);

/**
 * Who decides at this customer, and the one place it is maintained.
 *
 * A decision-maker is an account of this company, never a role and never a person without
 * one: what they may decide is written against their account, so naming somebody here and
 * opening their page show the same thing.
 */
const AuthorityPanel: React.FC<Props> = ({ customer }) => {
  const authority = useCustomerAuthority(customer);
  const save = useSaveCustomerAuthority(customer);

  const [editing, setEditing] = useState<Approver | null>(null);
  const [adding, setAdding] = useState(false);
  const [reading, setReading] = useState<Approver | null>(null);
  const [removing, setRemoving] = useState<Approver | null>(null);
  const [showingPast, setShowingPast] = useState(false);

  const rows = authority.data?.approvers ?? [];
  // a line that no longer decides is not deleted: it drops out of the table and into the
  // record of who decided before, which is what an end date is for
  const live = rows.filter((row) => row.deciding !== false);
  const past = rows.filter((row) => row.deciding === false);
  const gaps = authority.data?.gaps;
  const stuck = Boolean(gaps && (gaps.nobody_may_raise || gaps.nobody_may_approve));

  const remove = async () => {
    if (!removing) return;

    await save.mutateAsync({
      customer,
      enabled: authority.data?.enabled ? 1 : 0,
      approvers: rows.filter((row) => row.user !== removing.user),
    });
    setRemoving(null);
  };

  const restanding = async (row: Approver, status: 'Active' | 'Inactive') => {
    await save.mutateAsync({
      customer,
      enabled: authority.data?.enabled ? 1 : 0,
      approvers: rows.map((line) =>
        line.user === row.user
          ? {
              ...line,
              status,
              // putting somebody back in force cannot leave them behind their own end date
              effective_to: status === 'Active' ? null : line.effective_to ?? null,
            }
          : line
      ),
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            People Who Decide
            {live.length > 0 && (
              <>
                <span className="sr-only"> · </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                  {live.length}
                </span>
              </>
            )}
            <span
              title="Named accounts, never a role. What they may decide is set here and shown on their own page."
              className="text-slate-300"
            >
              <Info size={13} />
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            These people can submit and approve requests for {customer}. They also handle
            commercial and billing matters.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
        >
          <UserCog size={14} />
          Add Decision-Maker
        </button>
      </div>

      {stuck && gaps && (
        <div className="mx-5 mb-3 flex items-start gap-3 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200 sm:mx-6">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-amber-600 ring-1 ring-amber-200">
            <ShieldAlert size={16} strokeWidth={1.75} />
          </span>
          <p className="self-center text-sm text-amber-900">
            {gaps.nobody_may_approve && gaps.nobody_may_raise
              ? 'Nobody here may raise a request, and nobody may approve one. '
              : gaps.nobody_may_approve
                ? 'Nobody here may approve a request: every request from this company waits. '
                : 'Nobody here may raise a request. '}
            {gaps.accounts === 0
              ? 'Open an account for somebody first.'
              : 'Name the right person above.'}
          </p>
        </div>
      )}

      {live.length === 0 ? (
        <div className="flex items-center justify-center gap-3 px-5 pb-8 pt-5 text-sm text-slate-500">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
            <Users className="size-[18px]" strokeWidth={1.75} />
          </span>
          <span>
            {past.length > 0
              ? 'Nobody decides here at the moment.'
              : 'Nobody is named here yet.'}
          </span>
        </div>
      ) : (
        <div className="max-h-[26rem] overflow-auto pb-2">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Can submit</Th>
                <Th>Can approve</Th>
                <Th>Scope</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {live.map((row) => (
                <tr key={row.user} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td}`}>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={row.full_name || row.user} />
                      <span className="text-sm font-semibold text-slate-900">
                        {row.full_name || row.user}
                      </span>
                    </span>
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-500`}>
                    {row.email ?? row.user}
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                      Decision Maker
                    </span>
                  </td>
                  <td className={td}>
                    <Pill on={row.can_submit} />
                  </td>
                  <td className={td}>
                    <Pill on={row.can_approve} />
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {row.department ? `${row.department} Department` : 'Whole company'}
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                        TONES[standing(row).tone]
                      }`}
                    >
                      {standing(row).label}
                    </span>
                    {spell(row) && (
                      <span className="mt-1 block text-[11px] tabular-nums text-slate-400">{spell(row)}</span>
                    )}
                    {row.enabled === false && (
                      <span className="mt-1 block text-[11px] text-amber-600">
                        Account disabled
                      </span>
                    )}
                    {/* the line grants nothing once the account answers elsewhere, and it
                        blocks every later change here until it is taken off */}
                    {row.answers_here === false && (
                      <span className="mt-1 block text-[11px] font-semibold text-red-600">
                        No longer of this company — remove this line
                      </span>
                    )}
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <span className="flex items-center justify-end gap-2">
                      <Action label="View details" icon={Eye} onClick={() => setReading(row)} />
                      <Action
                        label="Edit what they decide"
                        icon={SquarePen}
                        onClick={() => setEditing(row)}
                      />
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'Stand them down',
                            icon: UserMinus,
                            onClick: () => restanding(row, 'Inactive'),
                          },
                          {
                            label: 'Remove from the matrix',
                            icon: Trash2,
                            danger: true,
                            onClick: () => setRemoving(row),
                          },
                        ]}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {past.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setShowingPast((current) => !current)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              No longer deciding
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                ({past.length})
              </span>
            </span>
            <ChevronDown
              size={16}
              className={`shrink-0 text-slate-400 transition-transform ${
                showingPast ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showingPast && (
            <ul className="mt-3 space-y-2">
              {past.map((row) => (
                <li
                  key={row.user}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={row.full_name || row.user} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-700">
                        {row.full_name || row.user}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {standing(row).label}
                        {spell(row) ? ` · ${spell(row)}` : ''}
                      </span>
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    <Action label="View details" icon={Eye} onClick={() => setReading(row)} />
                    <button
                      type="button"
                      onClick={() => restanding(row, 'Active')}
                      className="rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
                    >
                      Put back in force
                    </button>
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'Remove from the matrix',
                          icon: Trash2,
                          danger: true,
                          onClick: () => setRemoving(row),
                        },
                      ]}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DecisionMakerModal
        open={adding || editing !== null}
        customer={customer}
        enabled={authority.data?.enabled ?? true}
        approvers={rows}
        candidates={authority.data?.candidates ?? []}
        editing={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />

      <DecisionMakerDrawer
        open={reading !== null}
        customer={customer}
        approver={reading}
        onClose={() => setReading(null)}
      />

      <ConfirmModal
        open={removing !== null}
        title="Remove this decision-maker?"
        description="Their account stays as it is. They simply stop deciding for this company, and their own requests start waiting for somebody who may approve."
        confirmLabel="Remove"
        tone="warning"
        loading={save.isLoading}
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      >
        <p className="mt-3 text-sm text-slate-700">{removing?.full_name || removing?.user}</p>
      </ConfirmModal>
    </section>
  );
};

export default AuthorityPanel;
