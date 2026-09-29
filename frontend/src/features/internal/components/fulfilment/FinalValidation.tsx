import React, { useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ExecutionPlan } from '@/lib/api/internal';
import { useCompleteRequest } from '../../hooks/useRequests';
import { compactBadge } from '../../lib/workDisplay';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Step 4: say what the job came to, and close it. The request itself is never rewritten. */
const FinalValidation: React.FC<{
  plan: ExecutionPlan;
  requestCompleted?: boolean;
  onCompleted?: () => void;
}> = ({ plan, requestCompleted = false, onCompleted }) => {
  const complete = useCompleteRequest();
  const completionStarted = useRef(false);
  const outcome = plan.outcome;
  const done = requestCompleted || plan.status === 'Completed';
  const unresolved = outcome.unresolved_accepted;
  const completable = unresolved === 0;

  const figures = [
    plural(outcome.requested_done, 'accepted request line completed', 'accepted request lines completed'),
    plural(outcome.rejected, 'rejected request line', 'rejected request lines'),
    plural(outcome.technician_done, 'additional technician action completed', 'additional technician actions completed'),
    plural(outcome.requested_client_users_resolved, 'Requested Client User resolved', 'Requested Client Users resolved'),
    plural(outcome.requested_devices_resolved, 'Requested Device resolved', 'Requested Devices resolved'),
    plural(unresolved, 'unresolved accepted work item', 'unresolved accepted work items'),
    ...(outcome.requested_cancelled
      ? [plural(outcome.requested_cancelled, 'accepted work item cancelled', 'accepted work items cancelled')]
      : []),
  ];

  const completeRequest = async () => {
    if (done || !completable || completionStarted.current) return;
    completionStarted.current = true;

    try {
      await complete.mutateAsync({ name: plan.request });
      onCompleted?.();
    } catch {
      completionStarted.current = false;
    }
  };

  return (
    <div className="space-y-3">
      <section aria-label="Completion summary" className="overflow-hidden rounded-lg border border-slate-200">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs font-bold text-slate-900">{done ? 'Request completed' : 'Completion summary'}</p>
          {!done && completable && (
            <span className={`${compactBadge} border-emerald-200 bg-emerald-50 text-emerald-700`}>READY TO COMPLETE</span>
          )}
        </div>
        <ul className="divide-y divide-slate-100 px-3">
          {figures.map((figure) => (
            <li key={figure} className="py-2 text-xs text-slate-700">
              {figure}
            </li>
          ))}
        </ul>
      </section>

      {!done && !completable && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">
          This Request cannot be completed while accepted work remains unresolved.
        </p>
      )}

      {!done && complete.error instanceof Error && (
        <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
          {complete.error.message}
        </p>
      )}

      {!done && (
        <div className="flex flex-col items-stretch justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500">Unresolved accepted work prevents completion.</p>
          <button
            type="button"
            disabled={complete.isLoading || !completable}
            onClick={completeRequest}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 size={16} />
            {complete.isLoading ? 'Completing…' : 'Validate & complete request'}
          </button>
        </div>
      )}
    </div>
  );
};

export default FinalValidation;
