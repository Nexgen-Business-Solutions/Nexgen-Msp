import React from 'react';
import { AlertCircle, Check, PartyPopper } from 'lucide-react';
import type { ExecutionPlan } from '@/lib/api/internal';
import { useCompleteRequest } from '../hooks/useRequests';

const DONE: Record<string, string> = {
  'User Setup': 'User created',
  'Device Provisioning': 'Device prepared',
};

/** What the whole job came to, person by person, and the one button that closes the file. */
const RequestCompletionSummary: React.FC<{ plan: ExecutionPlan }> = ({ plan }) => {
  const close = useCompleteRequest();
  const finished = plan.status === 'Completed';

  const said = (card: { work_type: string; action: string; service_name: string | null; service_item: string | null }) =>
    DONE[card.work_type] ?? `${card.service_name ?? card.service_item} ${card.action.toLowerCase()}d`;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
        <PartyPopper size={15} className="text-slate-400" />
        {finished ? 'This request is closed' : 'Close the request'}
      </h3>

      <p className="mt-1 text-xs text-slate-500">
        {plan.summary.people} people prepared · {plan.summary.devices} devices provisioned ·{' '}
        {plan.summary.services} service changes
      </p>

      <div className="mt-3 space-y-3">
        {plan.groups.map((group) => (
          <div key={group.subject_key}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group.person?.full_name}
            </p>
            <ul className="mt-1 space-y-0.5">
              {[
                ...(group.user_setup ? [group.user_setup] : []),
                ...group.devices.map((slot) => slot.work),
                ...group.services,
              ].map((card) => (
                <li key={card.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                  {card.status === 'Completed' ? (
                    <Check size={12} className="shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle size={12} className="shrink-0 text-amber-600" />
                  )}
                  {said(card)}
                  {card.status !== 'Completed' && (
                    <span className="text-slate-400">· {card.status.toLowerCase()}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {plan.rejected.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rejected during review
          </p>
          <ul className="mt-1 space-y-0.5">
            {plan.rejected.map((row) => (
              <li key={row.idx} className="text-xs text-slate-500">
                {row.service}
                {row.reason ? ` — ${row.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!finished && (
        <>
          <button
            type="button"
            disabled={close.isLoading}
            onClick={() => close.mutate({ name: plan.request })}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            Complete request
          </button>

          {close.error instanceof Error && (
            <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {close.error.message}
            </p>
          )}
        </>
      )}
    </section>
  );
};

export default RequestCompletionSummary;
