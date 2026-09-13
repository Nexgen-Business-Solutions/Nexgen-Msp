import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, HandHelping, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import StatusBadge from '@/shared/components/StatusBadge';
import WorkflowHeader from '@/shared/components/WorkflowHeader';
import WorkflowStepper, { type WorkflowStep } from '@/shared/components/WorkflowStepper';
import RequestContextHeader from '../components/fulfilment/RequestContextHeader';
import LineReview from '../components/fulfilment/LineReview';
import ExecutionWorkspace from '../components/fulfilment/ExecutionWorkspace';
import ExecutionRecap from '../components/fulfilment/ExecutionRecap';
import FinalValidation from '../components/fulfilment/FinalValidation';
import {
  useAssignRequestTechnician,
  useRequestDetail,
  useRequestExecutionPlan,
  useRunRequestAction,
} from '../hooks/useRequests';
import type { ExecutionPlan, RequestDetail as Detail } from '@/lib/api/internal';
import { initials, pill } from '../lib/fulfilmentStyles';

const STEPS = [
  { key: 'review', label: 'Review lines' },
  { key: 'execute', label: 'Execute' },
  { key: 'verify', label: 'Verify' },
  { key: 'complete', label: 'Final validation' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// the work exists only once the request has been decided
const PLANNABLE = ['Approved', 'In Progress', 'Completed'];

const COPY: Record<StepKey, { title: string; sub: string }> = {
  review: {
    title: 'Review request lines',
    sub: 'Accept or reject each requested action before execution.',
  },
  execute: {
    title: 'Execute accepted actions',
    sub: 'Accepted request lines stay first. Add other legitimate actions whenever the situation requires them.',
  },
  verify: { title: 'Execution recap', sub: 'Review exactly what was performed before final validation.' },
  complete: { title: 'Final validation', sub: 'Confirm the final outcome and close the request.' },
};

const indexOf = (key: StepKey) => STEPS.findIndex((step) => step.key === key);

const contextFrom = (data: Detail) => ({
  customer: data.customer,
  requester: data.requester,
  requester_name: data.requester_name,
  raised_at: data.creation,
  requested_date:
    data.lines
      .map((line) => line.requested_effective_date)
      .filter(Boolean)
      .sort()[0] ?? null,
  priority: data.priority,
  people: new Set(data.lines.map((line) => line.client_user || line.device_holder || line.new_user_full_name)).size,
  lines: data.lines.length,
  details: data.details ?? null,
  customer_approved: true,
  technicians: [],
});

const counterFor = (step: StepKey, data: Detail, plan?: ExecutionPlan) => {
  if (step === 'review') {
    const pending = data.lines.filter((line) => line.line_status === 'Pending').length;
    return `${pending} decision${pending === 1 ? '' : 's'} remaining`;
  }
  if (!plan) return '';
  if (step === 'execute') {
    const open = plan.summary.open;
    return `${open} remaining`;
  }
  if (step === 'verify') return `${plan.recap.length} performed operation${plan.recap.length === 1 ? '' : 's'}`;
  return plan.status === 'Completed' ? 'Completed' : 'Ready to close';
};

export default function RequestDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useRequestDetail(name);
  const runAction = useRunRequestAction();
  const claim = useAssignRequestTechnician();

  const [prompt, setPrompt] = useState<{ action: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<StepKey | null>(null);

  const data = detail.data;
  const planned = Boolean(data && PLANNABLE.includes(data.status));
  const plan = useRequestExecutionPlan(planned ? name : undefined);

  // a dispute is handled on the invoice it contests, so a direct link lands there
  useEffect(() => {
    if (data?.billing_run) navigate(`/msp/billing/${data.billing_run}`, { replace: true });
  }, [data?.billing_run, navigate]);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'Request not found.'}
        </div>
      </div>
    );
  }

  const server: StepKey = planned ? (plan.data?.stages.current ?? 'execute') : 'review';
  // the recap leads straight on to the final validation; nothing further is reachable early
  const furthest = server === 'verify' ? indexOf('complete') : indexOf(server);
  const step: StepKey = viewing && indexOf(viewing) <= furthest ? viewing : server;
  const completed = data.status === 'Completed';

  const steps: WorkflowStep[] = STEPS.map((entry, index) => ({
    ...entry,
    state:
      entry.key === step
        ? 'current'
        : completed || index < indexOf(server)
          ? 'done'
          : 'todo',
  }));

  const headerActions = data.available_actions.filter((action) => ['reject', 'cancel'].includes(action.action));
  const unclaimed = (plan.data?.groups ?? [])
    .flatMap((group) => [
      ...(group.user_setup ? [group.user_setup] : []),
      ...group.devices.map((slot) => slot.work),
      ...group.services,
    ])
    .some((card) => !card.assigned_technician && !['Completed', 'Cancelled'].includes(card.status));
  const technicians = plan.data?.context.technicians ?? [];
  const actionError = runAction.error as Error | undefined;

  const confirmPrompt = async () => {
    if (!prompt || !reason.trim()) return;
    try {
      await runAction.mutateAsync({ name, action: prompt.action, reason: reason.trim() });
      setPrompt(null);
    } catch {
      // rendered in the dialog
    }
  };

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      <WorkflowHeader
        title={data.name}
        subtitle={
          planned
            ? 'Customer-approved request · technician fulfilment'
            : `${data.customer} · raised via ${data.source}`
        }
        onBack={() => navigate('/msp/requests')}
        backLabel="Back to requests"
        actions={
          <>
            <StatusBadge value={data.status} />
            {planned && <span className={pill('emerald')}>Customer approved</span>}
            {technicians.length > 0 && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-[11px] font-bold text-blue-700"
                >
                  {initials(technicians[0])}
                </span>
                <span>
                  <span className="block text-xs font-semibold text-slate-900">{technicians.join(', ')}</span>
                  <span className="block text-[11px] text-slate-400">Assigned technician</span>
                </span>
              </span>
            )}
            {unclaimed && !completed && (
              <button
                type="button"
                disabled={claim.isLoading}
                onClick={() => claim.mutate({ name })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <HandHelping size={14} />
                Take the work
              </button>
            )}
            {headerActions.map((action) => (
              <button
                key={action.action}
                type="button"
                onClick={() => {
                  setReason('');
                  setPrompt({ action: action.action, label: action.label });
                }}
                className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                {action.label}
              </button>
            ))}
          </>
        }
      />

      <RequestContextHeader context={plan.data?.context ?? contextFrom(data)} />

      {data.review && !data.review.contract_active && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {data.review.has_contract
              ? `This customer's contract is ${String(data.review.contract_status).toLowerCase()}, not active.`
              : 'This customer has no contract yet — nothing here can be billed.'}
          </p>
        </div>
      )}

      {data.rejection_reason && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {data.rejection_reason}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-3 shadow-sm">
        <WorkflowStepper
          steps={steps}
          canGo={(key) => indexOf(key as StepKey) <= furthest}
          onGo={(key) => setViewing(key as StepKey)}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{COPY[step].title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{COPY[step].sub}</p>
          </div>
          <span className={pill('slate')}>{counterFor(step, data, plan.data)}</span>
        </div>

        <div className="px-5 py-4">
          {actionError && !prompt && (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {actionError.message}
            </p>
          )}

          {step === 'review' ? (
            <LineReview
              request={data}
              continuing={runAction.isLoading}
              onContinue={async () => {
                try {
                  await runAction.mutateAsync({ name, action: 'approve' });
                  setViewing(null);
                } catch {
                  // shown above
                }
              }}
              onRejectRequest={() => {
                setReason('');
                setPrompt({ action: 'reject', label: 'Reject request' });
              }}
            />
          ) : !plan.data ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {plan.error ? (plan.error as Error).message : 'Loading the work…'}
            </p>
          ) : step === 'execute' ? (
            <ExecutionWorkspace plan={plan.data} people={data.people} onContinue={() => setViewing('verify')} />
          ) : step === 'verify' ? (
            <ExecutionRecap
              plan={plan.data}
              onContinue={completed ? undefined : () => setViewing('complete')}
            />
          ) : (
            <FinalValidation plan={plan.data} />
          )}
        </div>
      </section>

      <Modal
        open={Boolean(prompt)}
        onClose={() => setPrompt(null)}
        icon={TriangleAlert}
        tone="red"
        title={prompt?.label ?? ''}
        subtitle="A reason is required and stays on the record."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPrompt}
              disabled={!reason.trim() || runAction.isLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Confirm
            </button>
          </div>
        }
      >
        {actionError && (
          <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {actionError.message}
          </p>
        )}
        <textarea
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain the decision…"
          aria-label="Reason"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </Modal>
    </div>
  );
}
