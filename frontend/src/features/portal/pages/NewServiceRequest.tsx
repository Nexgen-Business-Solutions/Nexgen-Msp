import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Info, Save, Trash2 } from 'lucide-react';
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
import { useRequestBuilder } from '../hooks/useRequestBuilder';
import RequestSubjectStep from '../components/RequestSubjectStep';
import RequestChangesStep from '../components/RequestChangesStep';
import RequestScheduleStep from '../components/RequestScheduleStep';
import RequestReviewStep from '../components/RequestReviewStep';

const STEPS = [
  { key: 'person', label: 'Person' },
  { key: 'changes', label: 'Changes' },
  { key: 'when', label: 'When & details' },
  { key: 'review', label: 'Review' },
];

export default function NewServiceRequest() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [givingUp, setGivingUp] = useState(false);
  const rights = useMyApprovalRights();
  // a draft is picked up where it was left; a refused request is read back and corrected
  const builder = useRequestBuilder(
    () => navigate('/msp/requests'),
    params.get('draft') ?? undefined,
    params.get('from') ?? undefined,
    params.get('client_user') ?? undefined,
    params.get('new_user') === '1'
  );

  // staff serve every customer, so they must say who they are acting for; a contact has
  // only their own and never sees this
  const { data: session } = useSession();
  const onBehalf = !isPortalOnly(session?.roles);
  const customer = usePortalFilters((state) => state.customer);
  const setCustomer = usePortalFilters((state) => state.setCustomer);
  const options = useUserFilterOptions(onBehalf);

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

  const hasSubjects = builder.subjects.length > 0;
  const canLeaveStep = [hasSubjects, builder.intents.length > 0, true, builder.canSend][step];

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <WorkflowHeader
        title="New request"
        subtitle="Say who it is for and what should change. We work out how to carry it out."
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

            {builder.intents.length > 0 && (
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

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canLeaveStep}
                className={primaryBtn}
              >
                Continue
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => builder.send()}
                disabled={!builder.canSend || builder.sending}
                className={primaryBtn}
              >
                {builder.sending ? 'Sending…' : 'Submit request'}
              </button>
            )}
          </>
        }
        stepper={
          <WorkflowStepper
            steps={stepsInOrder(STEPS, step)}
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

      {builder.correcting && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-sm text-amber-900">
            This is a copy of a refused request. What it asked for has been read again against
            today's state — anything that no longer applies is flagged on the Changes step.
          </p>
        </div>
      )}

      {builder.reopening && (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Reading what was put aside…
        </p>
      )}

      {step === 0 && <RequestSubjectStep builder={builder} />}
      {step === 1 && <RequestChangesStep builder={builder} />}
      {step === 2 && <RequestScheduleStep builder={builder} />}
      {step === 3 && <RequestReviewStep builder={builder} />}

      {builder.error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 p-4">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm font-medium text-red-700">{builder.error.message}</span>
        </div>
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
