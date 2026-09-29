import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, ClipboardList, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import WorkflowStepper, { type WorkflowStep } from '@/shared/components/WorkflowStepper';
import FulfilmentHeader from '../components/fulfilment/FulfilmentHeader';
import LineReview from '../components/fulfilment/LineReview';
import ExecutionWorkspace from '../components/fulfilment/ExecutionWorkspace';
import ExecutionRecap from '../components/fulfilment/ExecutionRecap';
import FinalValidation from '../components/fulfilment/FinalValidation';
import { RequestPresentation } from '@/shared/request';
import type { BadgeTone } from '@/shared/request/format';
import {
  useInternalRequestPresentation,
  useRequestDetail,
  useRequestExecutionPlan,
  useRunRequestAction,
} from '../hooks/useRequests';
import type { ExecutionPlan, RequestDetail as Detail } from '@/lib/api/internal';
import { pill } from '../lib/fulfilmentStyles';

const STEPS = [
  { key: 'review', label: 'Review lines' },
  { key: 'execute', label: 'Execute' },
  { key: 'verify', label: 'Verify' },
  { key: 'complete', label: 'Final validation' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// the work exists only once the request has been decided
const PLANNABLE = ['Approved', 'In Progress', 'Completed'];

const COPY: Record<StepKey, { title: string; sub?: string }> = {
  review: {
    title: 'Review lines',
    sub: 'Accept or reject the requested work. Nothing is executed here.',
  },
  execute: {
    title: 'Execute',
  },
  verify: {
    title: 'Execution recap',
    sub: 'Review what was actually performed before final validation.',
  },
  complete: {
    title: 'Final validation',
    sub: 'Complete this fulfilment after all accepted work is resolved.',
  },
};

const indexOf = (key: StepKey) => STEPS.findIndex((step) => step.key === key);

// a request that is over is read back, never worked on again
const CLOSED = ['Completed', 'Rejected', 'Cancelled'];

const counterFor = (step: StepKey, data: Detail, plan?: ExecutionPlan) => {
  if (step === 'review') {
    const pending = data.lines.filter((line) => line.line_status === 'Pending').length;
    return `${pending} decision${pending === 1 ? '' : 's'} remaining`;
  }
  if (!plan) return '';
  if (step === 'verify') return `${plan.recap.length} performed operation${plan.recap.length === 1 ? '' : 's'}`;
  return plan.status === 'Completed' ? 'Completed' : 'Ready to close';
};

export default function RequestDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useRequestDetail(name);
  const runAction = useRunRequestAction();

  const [prompt, setPrompt] = useState<{ action: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<StepKey | null>(null);

  const data = detail.data;
  const planned = Boolean(data && PLANNABLE.includes(data.status));
  const plan = useRequestExecutionPlan(planned ? name : undefined);
  const readOnly = Boolean(
    data &&
      (CLOSED.includes(data.status) ||
        data.status === 'Submitted' ||
        (!planned && !data.can_decide_lines))
  );
  const presentation = useInternalRequestPresentation(data ? name : undefined);
  const [recapOpen, setRecapOpen] = useState(false);
  const [savedNow, setSavedNow] = useState(false);

  // a dispute is handled on the invoice it contests, so a direct link lands there
  useEffect(() => {
    if (data?.billing_run) navigate(`/msp/billing/${data.billing_run}`, { replace: true });
  }, [data?.billing_run, navigate]);

  // a draft is picked up again where it was being written
  useEffect(() => {
    if (data?.status === 'Draft') {
      navigate(`/msp/requests/new?draft=${encodeURIComponent(data.name)}`, { replace: true });
    }
  }, [data?.status, data?.name, navigate]);

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
  const closed = CLOSED.includes(data.status);

  const steps: WorkflowStep[] = STEPS.map((entry, index) => ({
    ...entry,
    state:
      entry.key === step
        ? 'current'
        : completed || index < indexOf(server)
          ? 'done'
          : 'todo',
  }));

  const headerActions = closed
    ? []
    : data.available_actions.filter((action) => ['reject', 'cancel'].includes(action.action));
  const actionError = runAction.error as Error | undefined;
  const shown = presentation.data;
  const entityCount = plan.data?.requested_entities.length ?? shown?.requested_entities.length ?? 0;
  const groupCount = shown?.action_groups.length ?? data.action_groups?.length ?? 0;
  const headerBadges: { tone: BadgeTone; label: string }[] = [
    ...(shown?.request.customer_approval.state === 'approved'
      ? [{ tone: 'emerald' as const, label: 'CUSTOMER APPROVED' }]
      : []),
    { tone: 'slate', label: String(data.priority).toUpperCase() },
    { tone: 'blue', label: `${groupCount} ACTION GROUP${groupCount === 1 ? '' : 'S'}` },
    ...(entityCount > 0
      ? [{ tone: 'amber' as const, label: `${entityCount} REQUESTED ENTIT${entityCount === 1 ? 'Y' : 'IES'}` }]
      : []),
  ];
  const saved =
    savedNow ||
    Boolean(
      plan.data &&
        (plan.data.action_groups.some((group) => group.work.some((card) => card.display_status === 'Completed')) ||
          plan.data.requested_entities.some((entity) => entity.status === 'Resolved'))
    );

  const confirmPrompt = async () => {
    if (!prompt || !reason.trim()) return;
    try {
      await runAction.mutateAsync({ name, action: prompt.action, reason: reason.trim() });
      setPrompt(null);
    } catch {
      // rendered in the dialog
    }
  };

  const warnings = (
    <>
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
    </>
  );

  const actionButtons = headerActions.map((action) => (
    <button
      key={action.action}
      type="button"
      onClick={() => {
        setReason('');
        setPrompt({ action: action.action, label: action.label });
      }}
      className="inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
    >
      {action.label}
    </button>
  ));

  const startButton = data.can_start && (
    <button
      key="start_review"
      type="button"
      disabled={runAction.isLoading}
      onClick={async () => {
        try {
          await runAction.mutateAsync({ name, action: 'start_review' });
          setViewing(null);
        } catch {
          return;
        }
      }}
      className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
    >
      Start work
    </button>
  );

  const actionErrorNote = actionError && !prompt && (
    <p className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      {actionError.message}
    </p>
  );

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      {readOnly ? (
        <>
          <button
            type="button"
            onClick={() => navigate('/msp/requests')}
            className="inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft size={15} />
            Back to requests
          </button>

          {presentation.data ? (
            <RequestPresentation
              presentation={presentation.data}
              mode={completed ? 'completed_detail' : 'internal_detail'}
              headerActions={
                startButton || actionButtons.length || (completed && plan.data && !presentation.data.fulfilment_outcome) ? (
                  <>
                    {startButton}
                    {actionButtons}
                    {completed && plan.data && !presentation.data.fulfilment_outcome && (
                      <button
                        type="button"
                        onClick={() => setRecapOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <ClipboardList size={15} />
                        View execution recap
                      </button>
                    )}
                  </>
                ) : undefined
              }
              notice={
                <>
                  {warnings}
                  {actionErrorNote}
                </>
              }
              onViewExecutionRecap={completed && plan.data ? () => setRecapOpen(true) : undefined}
            />
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              {presentation.error ? (presentation.error as Error).message : 'Loading the request…'}
            </p>
          )}
        </>
      ) : (
        <>
      <FulfilmentHeader
        name={data.name}
        customer={shown?.request.customer_name || data.customer}
        source={shown?.request.source ?? data.source}
        submittedAt={shown?.request.submitted_at ?? data.creation}
        badges={headerBadges}
        note={
          (shown?.request.details ?? data.details)
            ? {
                text: (shown?.request.details ?? data.details) as string,
                by: shown?.request.details_by ?? null,
                at: shown?.request.details_at ?? null,
              }
            : null
        }
        actions={actionButtons.length ? actionButtons : undefined}
        onBack={() => navigate('/msp/requests')}
        stepper={
          closed ? undefined : (
          <WorkflowStepper
            steps={steps}
            canGo={(key) => indexOf(key as StepKey) <= furthest}
            onGo={(key) => setViewing(key as StepKey)}
          />
          )
        }
      />

      {warnings}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{COPY[step].title}</h2>
            {COPY[step].sub && <p className="mt-0.5 text-sm text-slate-500">{COPY[step].sub}</p>}
          </div>
          {step === 'execute' ? (
            saved && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <Check size={13} />
                Progress saved automatically
              </span>
            )
          ) : (
            <span className={pill('slate')}>{counterFor(step, data, plan.data)}</span>
          )}
        </div>

        <div className="px-5 py-4">
          {actionErrorNote && <div className="mb-4">{actionErrorNote}</div>}

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
            <ExecutionWorkspace
              plan={plan.data}
              people={data.people}
              onSaved={() => setSavedNow(true)}
              onContinue={() => setViewing('verify')}
            />
          ) : step === 'verify' ? (
            <ExecutionRecap
              plan={plan.data}
              onContinue={completed ? undefined : () => setViewing('complete')}
            />
          ) : (
            <FinalValidation
              plan={plan.data}
              requestCompleted={completed}
              onCompleted={() => navigate('/msp/requests', { replace: true })}
            />
          )}
        </div>
      </section>
        </>
      )}

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

      <Modal
        open={recapOpen && Boolean(plan.data)}
        onClose={() => setRecapOpen(false)}
        icon={ClipboardList}
        title="Execution recap"
        widthClass="max-w-4xl"
      >
        {plan.data && <ExecutionRecap plan={plan.data} />}
      </Modal>
    </div>
  );
}
