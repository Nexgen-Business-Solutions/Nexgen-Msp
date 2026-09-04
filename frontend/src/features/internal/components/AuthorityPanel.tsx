import React from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCustomerAuthority } from '../hooks/useContracts';

type Props = { customer: string };

const RIGHTS: { key: 'can_submit' | 'can_approve'; label: string }[] = [
  { key: 'can_submit', label: 'Submit' },
  { key: 'can_approve', label: 'Approve' },
];

/**
 * Who decides at this customer, read only.
 *
 * The matrix is written on each account's own page, because what an account may do belongs
 * with the account. Here it is only shown, so the commercial side of a customer can be read
 * without leaving the page.
 */
const AuthorityPanel: React.FC<Props> = ({ customer }) => {
  const navigate = useNavigate();
  const authority = useCustomerAuthority(customer);

  const rows = authority.data?.approvers ?? [];
  const approves = rows.some((row) => row.can_approve);
  const gaps = authority.data?.gaps;
  const stuck = Boolean(gaps && (gaps.nobody_may_raise || gaps.nobody_may_approve));

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Who decides at this customer</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Named accounts, never a role. Set on each account's own page.
        </p>
      </div>

      {stuck && gaps && (
        <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {gaps.nobody_may_approve && gaps.nobody_may_raise
              ? 'Nobody at this company may raise a request, and nobody may approve one. '
              : gaps.nobody_may_approve
                ? 'Nobody at this company may approve a request: every request from here waits until someone is named. '
                : 'Nobody at this company may raise a request. '}
            Name the right person on their account page
            {gaps.accounts === 0 ? ', or open an account for them' : ''}.
          </p>
        </div>
      )}

      {!stuck && approves && (
        <p className="px-5 pb-3 text-sm text-slate-500">
          Requests from everyone else here wait for one of them. Their own reach us straight
          away.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-400">Nobody is named here yet.</p>
      ) : (
        <div className="max-h-[26rem] overflow-auto px-5 pb-4">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {['Account', ...RIGHTS.map((right) => right.label), 'Department', ''].map(
                  (label) => (
                    <th
                      key={label}
                      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                    >
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.user}>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-900">
                      {row.full_name || row.user}
                    </p>
                    <p className="text-xs text-slate-400">{row.user}</p>
                  </td>
                  {RIGHTS.map((right) => (
                    <td key={right.key} className="px-3 py-2.5 text-sm">
                      {row[right.key] ? (
                        <span className="font-medium text-emerald-700">Yes</span>
                      ) : (
                        <span className="text-slate-300">No</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-sm text-slate-600">
                    {row.department || 'Whole company'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/accounts/${encodeURIComponent(row.user)}`)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-800"
                    >
                      Open account
                      <ExternalLink size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AuthorityPanel;
