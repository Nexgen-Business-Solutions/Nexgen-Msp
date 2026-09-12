import React from 'react';
import { HandHelping } from 'lucide-react';
import type { ExecutionPlan } from '@/lib/api/internal';
import { useAssignRequestTechnician } from '../hooks/useRequests';
import RequestActivityTrail from './RequestActivityTrail';
import RequestCompletionSummary from './RequestCompletionSummary';
import RequestProgressStepper from './RequestProgressStepper';
import SubjectWorkGroup from './SubjectWorkGroup';

/**
 * The whole of the work, on the request. Nothing here opens a profile, a device page or a
 * work order: every act happens on the card that describes it.
 */
const RequestWorkbench: React.FC<{ plan: ExecutionPlan }> = ({ plan }) => {
  const claim = useAssignRequestTechnician();
  const unclaimed = plan.groups
    .flatMap((group) => [
      ...(group.user_setup ? [group.user_setup] : []),
      ...group.devices.map((slot) => slot.work),
      ...group.services,
    ])
    .some((card) => !card.assigned_technician && card.status !== 'Completed');

  return (
    <>
      <RequestProgressStepper stages={plan.stages.stages} current={plan.stages.current} />

      <div className="space-y-4 px-6 py-5">
        {unclaimed && (
          <button
            type="button"
            disabled={claim.isLoading}
            onClick={() => claim.mutate({ name: plan.request })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <HandHelping size={13} />
            Assign this request to me
          </button>
        )}

        {plan.groups.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            Nothing on this request was approved, so there is no work to carry out.
          </p>
        )}

        {plan.groups.map((group) => (
          <SubjectWorkGroup key={group.subject_key} group={group} customer={plan.customer} />
        ))}

        {plan.groups.length > 0 && <RequestCompletionSummary plan={plan} />}

        <RequestActivityTrail activity={plan.activity} />
      </div>
    </>
  );
};

export default RequestWorkbench;
