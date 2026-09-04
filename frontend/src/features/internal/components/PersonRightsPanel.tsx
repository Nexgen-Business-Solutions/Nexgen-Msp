import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleCheck, ShieldCheck } from 'lucide-react';
import { useAccountRights, useSetAccountRights } from '../hooks/useTeam';

type Props = { user: string };

const RIGHTS: { key: 'can_submit' | 'can_approve'; label: string; hint: string }[] = [
  { key: 'can_submit', label: 'Raise requests', hint: 'They may open a request from the portal' },
  {
    key: 'can_approve',
    label: 'Approve their company’s requests',
    hint: 'Nothing reaches Nexgen until they have agreed to it. Their own requests are agreed the moment they open them.',
  },
];

/** What the saved rights mean, in one sentence, for the four ways they can be set. */
const meaning = (customer: string, canSubmit: boolean, canApprove: boolean) => {
  if (canSubmit && canApprove) {
    return `Their own requests reach us straight away. Everyone else at ${customer} waits for their accord.`;
  }
  if (canApprove) {
    return `They decide for ${customer} but raise nothing themselves: the portal does not offer them a new request.`;
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

  const data = rights.data;
  const [form, setForm] = useState({ can_submit: false, can_approve: false });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({ can_submit: Boolean(data.can_submit), can_approve: Boolean(data.can_approve) });
    setDirty(false);
  }, [data]);

  const submit = async () => {
    if (!data) return;
    try {
      await save.mutateAsync({ ...form, department: data.department ?? '' });
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
