import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Info, Save, Trash2 } from 'lucide-react';
import { FrappeError } from '@/lib/api/client';
import ConfirmModal from '@/shared/components/ConfirmModal';
import WorkflowHeader, { primaryBtn, quietBtn, secondaryBtn } from '@/shared/components/WorkflowHeader';
import WorkflowStepper from '@/shared/components/WorkflowStepper';
import { stepsInOrder } from '@/shared/lib/workflowSteps';
import Select from '@/shared/components/Select';
import { useSession } from '@/shared/hooks/useSession';
import { isPortalOnly } from '@/shared/layout/navigation';
import { useUserFilterOptions } from '@/features/internal/hooks/useUsers';
import { usePortalFilters } from '../store/usePortalFilters';
import { useMyApprovalRights } from '../hooks/usePortal';
import {
  REQUEST_LOCKED,
  REVIEW_NEEDED,
  UNRESTORABLE_DRAFT,
  useRequestBuilder,
  type RequestSeed,
} from '../hooks/useRequestBuilder';
import RequestPeopleStep from '../components/RequestPeopleStep';
import RequestActionsStep from '../components/RequestActionsStep';
import RequestDetailsStep from '../components/RequestDetailsStep';
import RequestReviewStep from '../components/RequestReviewStep';

const STEPS = [
  { key: 'people', label: 'People' },
  { key: 'actions', label: 'Actions' },
  { key: 'details', label: 'Details' },
  { key: 'review', label: 'Review' },
];

export default function NewServiceRequest() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // an act started from a machine's own page arrives with the machine and the people on it
  const seed = (useLocation().state as { seed?: RequestSeed } | null)?.seed ?? null;
  const [step, setStep] = useState(seed ? 1 : 0);
  const [givingUp, setGivingUp] = useState(false);
  const rights = useMyApprovalRights();
  // a draft is picked up where it was left; a refused request is read back and corrected
  const edit = params.get('edit') ?? undefined;
  const builder = useRequestBuilder(
    (done) => navigate(edit ? `/msp/requests/${encodeURIComponent(done.name)}` : '/msp/requests'),
    params.get('draft') ?? undefined,
    params.get('from') ?? undefined,
    params.get('client_user') ?? undefined,
    seed,
    edit
  );
  const opened = params.get('draft') ?? params.get('from') ?? edit;

  // staff serve every customer, so they must say who they are acting for; a contact has
  // only their own and never sees this
  const { data: session } = useSession();
  const onBehalf = !isPortalOnly(session?.roles);
  const customer = usePortalFilters((state) => state.customer);
  const setCustomer = usePortalFilters((state) => state.setCustomer);
  const options = useUserFilterOptions(onBehalf);

  // a draft reopened by staff is worked on for the company it was written for
  useEffect(() => {
    if (onBehalf && builder.sourceCustomer && builder.sourceCustomer !== customer) {
      setCustomer(builder.sourceCustomer);
    }
  }, [onBehalf, builder.sourceCustomer, customer, setCustomer]);

  // only the accounts the company's authority matrix names may raise; the server refuses too
  if (rights.data?.can_submit === false) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <Info size={18} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-900">You may not raise requests</p>
            <p className="mt-1 text-sm text-amber-800">
              Your account has not been given the right to open requests for your company.
              Ask Nexgen if that should change.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (builder.locked && opened) {
    return (
      <div className="space-y-4 px-6 pb-6 pt-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-sm text-amber-900">{REQUEST_LOCKED}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/msp/requests/${encodeURIComponent(opened)}`)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft size={15} />
          Back to the request
        </button>
      </div>
    );
  }

  // a selection that moved between writing and sending: the people are named, never dropped
  const refusal = builder.error instanceof FrappeError ? builder.error : null;
  const stale =
    refusal?.code === 'REQUEST_SCOPE_CHANGED'
      ? ((refusal.detail?.people ?? []) as { client_user: string; full_name: string; reason: string }[])
      : null;

  const hasSubjects = builder.subjects.length > 0;
  const hasActions = builder.actionGroups.length > 0;
  const canLeaveStep = [hasSubjects, hasActions, true, builder.canSend][step];
  // the stepper counts what the customer has built so far, and says nothing when empty
  const steps = STEPS.map((entry) =>
    entry.key === 'people' && builder.subjects.length
      ? { ...entry, label: `People · ${builder.subjects.length}` }
      : entry.key === 'actions' && builder.actionGroups.length
        ? { ...entry, label: `Actions · ${builder.actionGroups.length}` }
        : entry
  );

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <WorkflowHeader
        title={builder.editing ? `Edit request ${builder.editing}` : 'New request'}
        subtitle="Build one request for one person, a Department, or the whole company."
        onBack={() => navigate('/msp/requests')}
        backLabel="Back to requests"
        actions={
          <>
            {builder.draft && (
              <button
                type="button"
                onClick={() => setGivingUp(true)}
                className={`${secondaryBtn} border-red-200 text-red-600 hover:bg-red-50`}
              >
                <Trash2 size={15} />
                Discard
              </button>
            )}

            {builder.canSave && (
              <button
                type="button"
                onClick={() => builder.putAside()}
                disabled={builder.saving}
                className={secondaryBtn}
              >
                <Save size={15} />
                Save draft
              </button>
            )}

            <button
              type="button"
              onClick={() => (step === 0 ? navigate('/msp/requests') : setStep(step - 1))}
              className={step === 0 ? quietBtn : secondaryBtn}
            >
              {step === 0 ? (
                'Cancel'
              ) : (
                <>
                  <ArrowLeft size={15} />
                  Back
                </>
              )}
            </button>

            {step < STEPS.length - 1 && (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canLeaveStep || builder.unrestorable}
                className={primaryBtn}
              >
                Continue
                <ArrowRight size={15} />
              </button>
            )}
          </>
        }
        stepper={
          <WorkflowStepper
            steps={stepsInOrder(steps, step)}
            canGo={(key) => STEPS.findIndex((entry) => entry.key === key) < step}
            onGo={(key) => setStep(STEPS.findIndex((entry) => entry.key === key))}
          />
        }
      />

      {onBehalf && (
        <div className="w-64">
          <Select
            searchable
            className="w-full"
            value={customer ?? ''}
            onChange={setCustomer}
            placeholder="Acting for which customer"
            options={(options.data?.customers ?? []).map((name) => ({
              value: name,
              label: name,
            }))}
          />
        </div>
      )}

      {seed && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
          <p className="text-sm text-blue-900">
            1 action added from {seed.deviceLabel}. You can add more changes before submitting.
          </p>
        </div>
      )}

      {builder.correcting && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-sm text-amber-900">
            This is a copy of a refused request. What it asked for has been read again against
            today's state — review the People and Actions steps before submitting.
          </p>
        </div>
      )}

      {builder.unrestorable && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 p-4">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-sm font-medium text-red-700">{UNRESTORABLE_DRAFT}</p>
        </div>
      )}

      {step >= 2 && builder.reviewNeeded && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          {REVIEW_NEEDED}
        </p>
      )}

      {builder.reopening && (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Reading what was put aside…
        </p>
      )}

      {!builder.unrestorable && step === 1 && !hasActions && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          Add at least one requested action before continuing.
        </p>
      )}

      {!builder.unrestorable && step === 0 && !hasSubjects && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          Add at least one person before continuing.
        </p>
      )}

      {!builder.unrestorable && (
        <>
          {step === 0 && <RequestPeopleStep builder={builder} />}
          {step === 1 && <RequestActionsStep builder={builder} />}
          {step === 2 && <RequestDetailsStep builder={builder} />}
          {step === 3 && <RequestReviewStep builder={builder} onEditActions={() => setStep(1)} />}
        </>
      )}

      {stale ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Some selected people changed after they were added to this request.
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Review the affected people before submitting. Newly added people are never included
              automatically.
            </p>
          </div>

          <ul className="space-y-1">
            {stale.map((person) => (
              <li key={person.client_user} className="text-sm text-amber-900">
                <span className="font-semibold">{person.full_name}</span> — {person.reason}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              className={`${secondaryBtn} border-amber-300 text-amber-900 hover:bg-amber-100`}
            >
              Review people
            </button>
            <button
              type="button"
              onClick={() =>
                builder.removeSubjectsFor(stale.map((person) => person.client_user))
              }
              className={`${secondaryBtn} border-amber-300 text-amber-900 hover:bg-amber-100`}
            >
              Remove unavailable people
            </button>
          </div>
        </div>
      ) : (
        builder.error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 p-4">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{builder.error.message}</span>
          </div>
        )
      )}

      <ConfirmModal
        open={givingUp}
        tone="danger"
        title="Discard this draft?"
        description="What you put aside goes with it. This cannot be undone."
        confirmLabel="Discard"
        onCancel={() => setGivingUp(false)}
        onConfirm={async () => {
          await builder.giveUp();
          setGivingUp(false);
          navigate('/msp/requests');
        }}
      />
    </div>
  );
}
