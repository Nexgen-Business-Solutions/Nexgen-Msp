import React, { useEffect, useState } from 'react';
import { AlertCircle, UserCog } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
import { useSaveCustomerAuthority } from '../hooks/useContracts';
import { useDepartmentOptions } from '../hooks/useSettings';
import type { Approver, AuthorityCandidate } from '@/lib/api/internal';

type Props = {
  open: boolean;
  customer: string;
  enabled: boolean;
  approvers: Approver[];
  candidates: AuthorityCandidate[];
  /** the line being changed, or nothing when somebody is being named for the first time */
  editing: Approver | null;
  onClose: () => void;
};

const RIGHTS = [
  ['can_submit', 'Raise requests', 'They may open a request from the portal'],
  [
    'can_approve',
    "Approve their company's requests",
    'They can approve company requests. Their own are approved when submitted.',
  ],
] as const;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
    {children}
  </label>
);

const INPUT =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-blue-400';

/**
 * Naming somebody to decide for this company, or changing what they decide.
 *
 * Only an account that already answers for this company can be named: a decision-maker is
 * one of the customer's own portal users, and what happens here is giving them the right
 * to decide — never opening an account, which is the accounts screen's business.
 *
 * The matrix is written whole, so what is saved is the list as it stands with this one line
 * put in or replaced — never a half-written document.
 */
const DecisionMakerModal: React.FC<Props> = ({
  open,
  customer,
  enabled,
  approvers,
  candidates,
  editing,
  onClose,
}) => {
  const save = useSaveCustomerAuthority(customer);
  const departments = useDepartmentOptions(customer);

  const [user, setUser] = useState('');
  const [rights, setRights] = useState({ can_submit: true, can_approve: false });
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');

  useEffect(() => {
    if (!open) return;
    setUser(editing?.user ?? '');
    setRights({
      can_submit: editing ? editing.can_submit : true,
      can_approve: editing ? editing.can_approve : false,
    });
    setDepartment(editing?.department ?? '');
    setStatus(editing?.status ?? 'Active');
    setFrom(editing?.effective_from ?? '');
    setUntil(editing?.effective_to ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const named = new Set(approvers.map((row) => row.user));
  const offered = candidates.filter((row) => editing?.user === row.user || !named.has(row.user));
  const error = save.error as Error | undefined;

  const submit = async () => {
    try {
      const line: Approver = {
        user,
        full_name: candidates.find((row) => row.user === user)?.full_name ?? null,
        department: department || null,
        status,
        effective_from: from || null,
        effective_to: until || null,
        ...rights,
      };
      const kept = approvers.filter((row) => row.user !== user);

      await save.mutateAsync({ customer, enabled: enabled ? 1 : 0, approvers: [...kept, line] });
      onClose();
    } catch {
      // surfaced below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserCog}
      tone="blue"
      title={editing ? 'Edit decision-maker' : 'Add decision-maker'}
      subtitle={`${customer} — what this account may decide for the company.`}
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!user || save.isLoading || (!rights.can_submit && !rights.can_approve)}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Account">
          <Select
            className="w-full"
            searchable
            value={user}
            onChange={setUser}
            placeholder={offered.length ? 'Choose an account' : 'No account left to name'}
            options={offered.map((row) => ({
              value: row.user,
              label: row.full_name,
              description: `${row.email}${row.role ? ` · ${row.role}` : ''}`,
            }))}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Only a portal account of {customer} can decide for it. Accounts are opened on
            the accounts screen.
          </p>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          {RIGHTS.map(([key, label, hint]) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={rights[key]}
                onChange={(event) =>
                  setRights((current) => ({ ...current, [key]: event.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">{label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Can approve for</label>
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                checked={!department}
                onChange={() => setDepartment('')}
                className="h-4 w-4 border-slate-300"
              />
              Whole company
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                checked={Boolean(department)}
                disabled={(departments.data ?? []).length === 0}
                onChange={() => setDepartment((departments.data ?? [])[0]?.value ?? '')}
                className="h-4 w-4 border-slate-300"
              />
              Department
            </label>
            {department && (
              <Select
                className="w-56"
                value={department}
                onChange={setDepartment}
                placeholder="Select department"
                options={departments.data ?? []}
              />
            )}
          </div>
        </div>

        {/* a relationship outlives a change of mind: standing somebody down, or handing
            over on an agreed day, never touches the account itself */}
        {editing && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">The relationship itself</p>

            <div className="mt-2 flex flex-wrap items-center gap-5">
              {(['Active', 'Inactive'] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="radio"
                    checked={status === value}
                    onChange={() => setStatus(value)}
                    className="h-4 w-4 border-slate-300"
                  />
                  {value === 'Active' ? 'In force' : 'Stood down'}
                </label>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Decides from">
                <input
                  type="date"
                  className={INPUT}
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </Field>
              <Field label="Until">
                <input
                  type="date"
                  className={INPUT}
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </Field>
            </div>

            <p className="mt-2 text-[11px] text-slate-500">
              Leave the dates empty for a relationship with no end. Standing somebody down
              keeps the line and its history; removing it is a separate act.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default DecisionMakerModal;
