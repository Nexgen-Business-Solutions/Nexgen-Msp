import React from 'react';
import { CalendarDays, Trash2, Wrench } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { usePortalFilterOptions } from '../hooks/usePortal';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const PRIORITIES = [
  { value: 'Low', label: 'Low', hint: 'No rush' },
  { value: 'Medium', label: 'Medium', hint: 'Standard' },
  { value: 'High', label: 'High', hint: 'Important' },
  { value: 'Urgent', label: 'Urgent', hint: 'Business blocked' },
];

/** When it should happen, how urgent it is, and anything worth saying about the request. */
const RequestScheduleStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const options = usePortalFilterOptions();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <FieldLabel>Requested date</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={builder.defaultDate}
            onChange={(event) => builder.setDefaultDate(event.target.value)}
            className={`${inputClass} max-w-xs`}
          />
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarDays size={13} className="text-slate-400" />
            Applies to everything in this request unless an item says otherwise.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <FieldLabel>Priority</FieldLabel>
        <div className="grid gap-2 sm:grid-cols-4">
          {PRIORITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => builder.setPriority(option.value)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                builder.priority === option.value
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
              <span className="block text-xs text-slate-500">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            What you are asking for
          </h3>
        </div>

        {builder.intents.map((intent) => {
          const subject = builder.subjects.find((row) => row.key === intent.subjectKey);

          return (
            <div key={intent.key} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {intent.actionLabel} · {intent.serviceLabel}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {subject?.fullName || 'New person'}
                    {intent.deviceLabel ? ` · ${intent.deviceLabel}` : ''}
                    {intent.isNewDevice ? ' · device to be identified' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={intent.requestedEffectiveDate || builder.defaultDate}
                    onChange={(event) =>
                      builder.updateIntent(intent.key, {
                        requestedEffectiveDate: event.target.value,
                      })
                    }
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => builder.removeIntent(intent.key)}
                    aria-label={`Remove ${intent.serviceLabel}`}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* the machine is the technician's to identify — but a customer who already
                  knows which one it is, or has it in front of them, may say so */}
              {intent.isNewDevice && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Wrench size={13} className="text-slate-400" />
                    A technician will prepare or identify the device. If you already know it,
                    you can say so — none of this is required.
                  </p>

                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-blue-500"
                      value={intent.deviceHostname ?? ''}
                      onChange={(event) =>
                        builder.updateIntent(intent.key, { deviceHostname: event.target.value })
                      }
                      placeholder="Hostname (optional)"
                      aria-label="Hostname (optional)"
                    />
                    <input
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-blue-500"
                      value={intent.deviceSerial ?? ''}
                      onChange={(event) =>
                        builder.updateIntent(intent.key, { deviceSerial: event.target.value })
                      }
                      placeholder="Serial number (optional)"
                      aria-label="Serial number (optional)"
                    />
                    <Select
                      className="w-full"
                      value={intent.deviceType ?? ''}
                      onChange={(value) => builder.updateIntent(intent.key, { deviceType: value })}
                      placeholder="Device type (optional)"
                      options={(options.data?.device_types ?? []).map((type) => ({
                        value: type,
                        label: type,
                      }))}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <FieldLabel>Details</FieldLabel>
        <textarea
          rows={4}
          value={builder.details}
          onChange={(event) => builder.setDetails(event.target.value)}
          placeholder="Anything the technician should know about this request (optional)."
          aria-label="Details"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>
    </div>
  );
};

export default RequestScheduleStep;
