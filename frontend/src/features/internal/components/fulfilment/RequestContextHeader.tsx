import React from 'react';
import type { RequestContext } from '@/lib/api/internal';
import { fmtDate, fmtStamp, initials } from '../../lib/fulfilmentStyles';

const Cell: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</p>
  </div>
);

/** The request, kept in view at every step: who asked, for when, and what they wrote. */
const RequestContextHeader: React.FC<{ context: RequestContext; embedded?: boolean }> = ({
  context,
  embedded = false,
}) => (
  <section className={embedded ? '' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm'}>
    <div>
      <p className="text-sm font-semibold text-slate-900">Request information</p>
      <p className="text-xs text-slate-500">Available throughout the fulfilment workflow</p>
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <Cell label="Customer" value={context.customer} />
      <Cell label="Requested by" value={context.requester_name || context.requester || '—'} />
      <Cell label="Requested date" value={fmtDate(context.requested_date)} />
      <Cell label="Priority" value={context.priority} />
      <Cell label="People" value={context.people} />
      <Cell label="Request lines" value={context.lines} />
    </div>

    {context.details && (
      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-xs font-bold text-blue-700"
            >
              {initials(context.requester_name || context.requester)}
            </span>
            <div>
              <p className="text-sm font-semibold text-blue-900">
                {context.requester_name || context.requester || 'Requester'}
              </p>
              <p className="text-xs text-slate-500">Requester · {fmtStamp(context.raised_at)}</p>
            </div>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Requester note
          </p>
        </div>
        <p className="mt-2 whitespace-pre-line rounded-lg border border-blue-100 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700">
          {context.details}
        </p>
      </div>
    )}
  </section>
);

export default RequestContextHeader;
