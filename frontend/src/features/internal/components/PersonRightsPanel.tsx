import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CircleCheck, ShieldCheck } from 'lucide-react';
import Select from '@/shared/components/Select';
import { useAccountRights, useSetAccountRights } from '../hooks/useTeam';
import { useDepartmentOptions } from '../hooks/useSettings';

type Props = { user: string };

const RIGHTS: { key: 'can_submit' | 'can_approve'; label: string; hint: string }[] = [
  { key: 'can_submit', label: 'Raise requests', hint: 'They may open a request from the portal' },
  {
    key: 'can_approve',
    label: 'Approve their company’s requests',
    hint: 'They can approve company requests. Their own requests are approved when submitted.',
  },
];

/** What the saved rights mean, in one sentence, for the four ways they can be set. */
const meaning = (customer: string, canSubmit: boolean, canApprove: boolean) => {
  if (canSubmit && canApprove) {
    return `They can submit and approve requests for ${customer}. Their own requests reach us immediately.`;
  }
  if (canApprove) {
    return `They can approve requests for ${customer}, but cannot create requests.`;
  }
  if (canSubmit) {
    return `Their requests wait for someone at ${customer} who may approve.`;
  }
  return `Not named: they may raise requests, which wait for someone at ${customer} who may approve.`;
};

/** What one account decides for its company, edited where the account lives and saved as one. */
const PersonRightsPanel: React.FC<Props> = ({ user }) => {
  const rights = useAccountRights(user);
  const save = useSetAccountRights(user);
  const departmentOptions = useDepartmentOptions(rights.data?.customer ?? null);

  const data = rights.data;
  const [form, setForm] = useState({ can_submit: false, can_approve: false });
  const [department, setDepartment] = useState('');
  const [dirty, setDirty] = useState(false);
  const departmentChoices = useMemo(() => {
    const active = departmentOptions.data ?? [];
    if (!department || active.some((option) => option.value === department)) return active;
    return [
      { value: department, label: `${department} (unavailable)`, description: 'Kept for this existing approver' },
      ...active,
    ];
  }, [department, departmentOptions.data]);
  const cannotChooseDepartment =
    !department &&
    (departmentOptions.isLoading || Boolean(departmentOptions.error) || departmentChoices.length === 0);

  useEffect(() => {
    if (!data) return;
    setForm({ can_submit: Boolean(data.can_submit), can_approve: Boolean(data.can_approve) });
    setDepartment(data.department ?? '');
    setDirty(false);
  }, [data]);

  const submit = async () => {
    if (!data) return;
    try {
      await save.mutateAsync({ ...form, department });
      setDirty(false);
    } catch {
      // surfaced below
    }
  };

  if (!data || !data.is_customer_account) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">What they decide for their company</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Given to this account by name, for {data.customer}.
        </p>

        <div className="mt-4 space-y-3">
          {RIGHTS.map((right) => (
            <label key={right.key} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={form[right.key]}
                disabled={save.isLoading}
                onChange={(event) => {
                  setForm((current) => ({ ...current, [right.key]: event.target.checked }));
                  setDirty(true);
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">{right.label}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{right.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
          <span className="block text-sm font-medium text-slate-800">Can approve for</span>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              checked={!department}
              disabled={save.isLoading}
              onChange={() => {
                setDepartment('');
                setDirty(true);
              }}
              className="h-4 w-4 border-slate-300"
            />
            <span className="text-sm text-slate-700">Whole company</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              checked={Boolean(department)}
              disabled={save.isLoading || cannotChooseDepartment}
              onChange={() => {
                setDepartment((departmentOptions.data ?? [])[0]?.value ?? '');
                setDirty(true);
              }}
              className="h-4 w-4 border-slate-300"
            />
            <span className="text-sm text-slate-700">Department</span>
          </label>
          {department && (
            <Select
              className="ml-6 w-full max-w-xs"
              value={department}
              onChange={(value) => {
                setDepartment(value);
                setDirty(true);
              }}
              placeholder="Select department"
              options={departmentChoices}
            />
          )}
          {departmentOptions.isLoading && (
            <p className="ml-6 text-xs text-slate-500">Loading departments…</p>
          )}
          {departmentOptions.error instanceof Error && (
            <p className="ml-6 text-xs text-red-600">{departmentOptions.error.message}</p>
          )}
          {!departmentOptions.isLoading && !departmentOptions.error && departmentChoices.length === 0 && (
            <p className="ml-6 text-xs text-amber-700">
              No department is available. Add one in Settings first.
            </p>
          )}
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-500" />
          {meaning(data.customer ?? '', Boolean(data.can_submit), Boolean(data.can_approve))}
        </p>

        {save.error instanceof Error && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          {!dirty && save.isSuccess && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CircleCheck size={15} />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!dirty || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PersonRightsPanel;
