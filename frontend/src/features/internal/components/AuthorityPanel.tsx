import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleCheck, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import Select from '@/shared/components/Select';
import { useCustomerAuthority, useSaveCustomerAuthority } from '../hooks/useContracts';
import type { Approver } from '@/lib/api/internal';

type Props = { customer: string };

const RIGHTS: { key: keyof Approver; label: string; hint: string }[] = [
  { key: 'can_submit', label: 'Submit', hint: 'May raise a request' },
  {
    key: 'can_approve',
    label: 'Approve',
    hint: "May approve their company's requests — their own are agreed as they open them",
  },
];

/**
 * The authority matrix of one customer: named people, never a role. Until someone here may
 * approve, that customer's requests reach Nexgen exactly as they always did.
 */
const AuthorityPanel: React.FC<Props> = ({ customer }) => {
  const authority = useCustomerAuthority(customer);
  const save = useSaveCustomerAuthority(customer);

  const [rows, setRows] = useState<Approver[]>([]);
  const [adding, setAdding] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (authority.data) {
      setRows(authority.data.approvers);
      setDirty(false);
    }
  }, [authority.data]);

  const candidates = authority.data?.candidates ?? [];
  const taken = new Set(rows.map((row) => row.client_user));
  const free = candidates.filter((person) => !taken.has(person.name));

  const change = (index: number, patch: Partial<Approver>) => {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
    setDirty(true);
  };

  const add = (person: string) => {
    const found = candidates.find((item) => item.name === person);
    if (!found) return;

    setRows((current) => [
      ...current,
      {
        client_user: found.name,
        full_name: found.full_name,
        department: null,
        can_submit: true,
        can_approve: true,
      },
    ]);
    setAdding('');
    setDirty(true);
  };

  // what is actually in force, not what is merely ticked: the sentence states a fact, so
  // it must not appear before Save has made it true
  const approves = (authority.data?.approvers ?? []).some((row) => row.can_approve);
  const willApprove = rows.some((row) => row.can_approve);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Who decides at this customer</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Named people, never a role. While nobody here may approve, their requests reach us
            straight away — exactly as today.
          </p>
        </div>
        <button
          type="button"
          disabled={!dirty || save.isLoading}
          onClick={() =>
            save.mutate(
              { customer, enabled: 1, approvers: rows },
              { onSuccess: () => setDirty(false) }
            )
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            'Save'
          )}
        </button>
      </div>

      {save.error instanceof Error && (
        <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm font-medium text-red-700">{save.error.message}</span>
        </div>
      )}

      {(approves || willApprove) && (
        <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {approves
              ? 'Requests from everyone else here now wait for one of them. Their own reach us straight away.'
              : 'Once saved, requests from everyone else here will wait for one of them. Their own will still reach us straight away.'}
          </p>
        </div>
      )}

      <div className="max-h-[26rem] overflow-auto px-5 pb-4">
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              {['Person', ...RIGHTS.map((right) => right.label), 'Department', ''].map((label) => (
                <th
                  key={label}
                  className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:rounded-l-lg last:rounded-r-lg"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={RIGHTS.length + 3} className="px-3 py-8 text-center text-sm text-slate-500">
                  Nobody named — this customer's requests come straight to us.
                </td>
              </tr>
            )}

            {rows.map((row, index) => (
              <tr key={row.client_user}>
                <td className="whitespace-nowrap px-3 py-3">
                  <p className="text-sm font-semibold text-slate-900">{row.full_name}</p>
                </td>
                {RIGHTS.map((right) => (
                  <td key={right.key} className="whitespace-nowrap px-3 py-3">
                    <input
                      type="checkbox"
                      title={right.hint}
                      checked={Boolean(row[right.key])}
                      onChange={(event) => change(index, { [right.key]: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                ))}
                <td className="px-3 py-3">
                  <input
                    type="text"
                    value={row.department ?? ''}
                    onChange={(event) => change(index, { department: event.target.value || null })}
                    placeholder="Whole company"
                    className="h-9 w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => {
                      setRows((current) => current.filter((_, at) => at !== index));
                      setDirty(true);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex items-center gap-2">
          <Select
            searchable
            className="w-72"
            value={adding}
            onChange={add}
            placeholder={free.length ? 'Name someone…' : 'Everyone is already named'}
            options={free.map((person) => ({
              value: person.name,
              label: person.full_name,
              description: person.portal_user
                ? (person.department ?? undefined)
                : 'No portal access yet',
            }))}
          />
          <Plus size={15} className="text-slate-400" />
          {!dirty && save.isSuccess && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CircleCheck size={15} />
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthorityPanel;
