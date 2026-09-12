import React from 'react';
import { Info, Laptop, Wrench } from 'lucide-react';
import { useRequestSubmissionContext } from '../hooks/usePortal';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

/** The request as a person would read it back, grouped the way it was thought of. */
const RequestReviewStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const submission = useRequestSubmissionContext();

  return (
    <div className="space-y-4">
      {builder.subjects.map((subject) => {
        const intents = builder.intentsOf(subject.key);
        const personal = intents.filter((intent) => !intent.managedDevice && !intent.isNewDevice);
        const onDevices = intents.filter((intent) => intent.managedDevice);
        const toProvision = intents.filter((intent) => intent.isNewDevice);

        return (
          <div key={subject.key} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-bold text-slate-900">
                {subject.fullName || 'New person'}
              </p>
              {subject.department && (
                <span className="text-xs text-slate-500">{subject.department}</span>
              )}
              {subject.kind === 'new' && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  NEW USER
                </span>
              )}
            </div>

            {intents.length === 0 && (
              <p className="mt-2 text-sm text-amber-700">Nothing is asked for this person yet.</p>
            )}

            {personal.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Personal
                </p>
                <ul className="mt-1 space-y-1">
                  {personal.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{intent.serviceLabel}</span>
                      {' — '}
                      {intent.actionLabel} from{' '}
                      {fmtDate(intent.requestedEffectiveDate || builder.defaultDate)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {onDevices.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Devices
                </p>
                <ul className="mt-1 space-y-1">
                  {onDevices.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <Laptop size={13} className="mr-1.5 inline text-slate-400" />
                      <span className="font-medium text-slate-900">{intent.deviceLabel}</span>
                      {' · '}
                      {intent.serviceLabel} — {intent.actionLabel} from{' '}
                      {fmtDate(intent.requestedEffectiveDate || builder.defaultDate)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {toProvision.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Device required
                </p>
                <ul className="mt-1 space-y-1">
                  {toProvision.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <Wrench size={13} className="mr-1.5 inline text-slate-400" />
                      {intent.serviceLabel} — a technician will prepare or identify the device
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Priority:</span> {builder.priority}
        </p>
      </div>

      {submission.data && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
          <div>
            <p className="text-sm font-semibold text-blue-900">After submission</p>
            <p className="mt-0.5 text-sm text-blue-800">{submission.data.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestReviewStep;
