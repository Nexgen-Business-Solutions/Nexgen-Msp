import React from 'react';
import { format } from 'date-fns';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const PRIORITIES = ['Low', 'Medium', 'High'];

/**
 * The business context the whole request shares.
 *
 * Nothing technical is asked here. What the customer does not know — a username, a serial,
 * which machine exactly — is completed during fulfilment, by the people who can find out.
 */
const RequestDetailsStep: React.FC<{ builder: Builder }> = ({ builder }) => (
  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-5 py-4">
      <h2 className="text-base font-semibold text-slate-900">Details</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Shared business context for the whole request.
      </p>
    </div>

    <div className="max-w-3xl space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Requested date</FieldLabel>
          <input
            type="date"
            aria-label="Requested date"
            value={builder.requestedDate}
            min={format(new Date(), 'yyyy-MM-dd')}
            onChange={(event) => builder.setRequestedDate(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-slate-500">Optional target date.</p>
        </div>

        <div>
          <FieldLabel>Priority</FieldLabel>
          <Select
            className="w-full"
            value={builder.priority}
            onChange={builder.setPriority}
            options={PRIORITIES.map((value) => ({ value, label: value }))}
          />
        </div>
      </div>

      <div>
        <FieldLabel>Business note</FieldLabel>
        <textarea
          rows={4}
          value={builder.details}
          onChange={(event) => builder.setDetails(event.target.value)}
          placeholder="Anything Nexgen should know about this request."
          aria-label="Business note"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>
    </div>
  </section>
);

export default RequestDetailsStep;
