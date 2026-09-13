import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Info, Save, Trash2 } from 'lucide-react';
import ConfirmModal from '@/shared/components/ConfirmModal';
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
    params.get('client_user') ?? undefined
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">New request</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Say who it is for and what should change. We work out how to carry it out.
          </p>
        </div>

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
      </div>

      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                index === step
                  ? 'bg-blue-600 text-white'
                  : index < step
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  index < step ? 'bg-blue-600 text-white' : 'bg-white/20'
                }`}
              >
                {index < step ? <Check size={12} /> : index + 1}
              </span>
              {entry.label}
            </button>
            {index < STEPS.length - 1 && <span className="text-slate-300">/</span>}
          </li>
        ))}
      </ol>

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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (step === 0 ? navigate('/msp/requests') : setStep(step - 1))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ArrowLeft size={15} />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {builder.intents.length > 0 && (
            <button
              type="button"
              onClick={() => builder.putAside()}
              disabled={builder.saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <Save size={15} />
              Save draft
            </button>
          )}

          {builder.draft && (
            <button
              type="button"
              onClick={() => setGivingUp(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 size={15} />
              Discard
            </button>
          )}
        </div>

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            disabled={!canLeaveStep}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue
            <ArrowRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => builder.send()}
            disabled={!builder.canSend || builder.sending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {builder.sending ? 'Sending…' : 'Submit request'}
          </button>
        )}
      </div>

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
