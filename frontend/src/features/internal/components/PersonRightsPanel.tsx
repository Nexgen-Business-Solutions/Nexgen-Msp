import React from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { useAccountRights, useSetAccountRights } from '../hooks/useTeam';

type Props = { user: string };

const RIGHTS: { key: string; label: string; hint: string }[] = [
  { key: 'can_submit', label: 'Raise requests', hint: 'They may open a request from the portal' },
  {
    key: 'can_approve',
    label: 'Approve their company’s requests',
    hint: 'Nothing reaches Nexgen until they have agreed to it. Their own requests are agreed the moment they open them.',
  },
];

/** What one account decides for its company, edited where the account lives. */
const PersonRightsPanel: React.FC<Props> = ({ user }) => {
  const rights = useAccountRights(user);
  const save = useSetAccountRights(user);

  const data = rights.data;
  const current = (save.data ?? data) as Record<string, unknown> | undefined;

  const toggle = (key: string, value: boolean) => {
    if (!current) return;

    save.mutate({
      can_submit: key === 'can_submit' ? value : current.can_submit,
      can_approve: key === 'can_approve' ? value : current.can_approve,
      department: current.department ?? '',
    });
  };

  if (!data || !data.is_customer_account) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">What they decide for their company</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Given to this account by name, for {data.customer}.
        </p>

        {save.error instanceof Error && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {RIGHTS.map((right) => (
            <label key={right.key} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={Boolean(current?.[right.key])}
                disabled={save.isLoading}
                onChange={(event) => toggle(right.key, event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">{right.label}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{right.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {Boolean(current?.can_approve) && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-600" />
            Their own requests now reach us straight away. Everyone else at {data.customer}{' '}
            waits for their accord.
          </p>
        )}
      </div>
    </div>
  );
};

export default PersonRightsPanel;
