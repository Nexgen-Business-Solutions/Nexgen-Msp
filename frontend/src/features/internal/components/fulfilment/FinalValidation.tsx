import React, { useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { ExecutionPlan } from '@/lib/api/internal';
import { useCompleteRequest } from '../../hooks/useRequests';

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

  const completeRequest = async () => {
    if (done || completionStarted.current) return;
    completionStarted.current = true;

    try {
      await complete.mutateAsync({ name: plan.request });
      onCompleted?.();
    } catch {
      completionStarted.current = false;
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 size={16} />
          {done ? 'Request completed' : 'Ready for final validation'}
        </p>
        <p className="mt-1 text-sm">
          {outcome.requested_done} accepted request line{outcome.requested_done === 1 ? '' : 's'} completed ·{' '}
          {outcome.rejected} rejected · {outcome.technician_done} additional action
          {outcome.technician_done === 1 ? '' : 's'} completed · {outcome.prepared} created or prepared
          {outcome.context_done
            ? ` · ${outcome.context_done} profile change${outcome.context_done === 1 ? '' : 's'}`
            : ''}
          .
        </p>
      </div>

      {!done && (
        <>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            The audit trail keeps the original request lines, the technician's decisions, the Client
            User and Device preparation, the requested actions performed and every additional action.
          </p>

          {complete.error instanceof Error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {complete.error.message}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={complete.isLoading}
              onClick={completeRequest}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <CheckCircle2 size={16} />
              {complete.isLoading ? 'Completing…' : 'Validate & complete request'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default FinalValidation;
