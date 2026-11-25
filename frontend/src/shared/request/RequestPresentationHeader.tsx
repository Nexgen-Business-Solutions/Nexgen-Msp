import type { ReactNode } from 'react';
import type { RequestPresentation, RequestPresentationMode } from './types';
import { badgeClass, formatDate, formatStamp } from './format';

type Props = {
  presentation: RequestPresentation;
  mode: RequestPresentationMode;
  actions?: ReactNode;
};

const subtitleOf = (presentation: RequestPresentation, mode: RequestPresentationMode) => {
  const { request } = presentation;
  if (mode === 'creation_review') return 'Confirm the exact snapshot and requested actions before submission.';
  if (mode === 'customer_approval') {
    const requester = request.requester_name || request.requester || request.customer_name || request.customer;
    return `Review the exact request submitted by ${requester} before it is sent to Nexgen.`;
  }
  if (mode === 'internal_review') return 'Review the customer-approved request before execution.';
  if (mode === 'completed_detail') return 'Completed request · final intent and fulfilment outcome.';
  return null;
};

const Cell = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="min-w-0 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</p>
  </div>
);

export default function RequestPresentationHeader({ presentation, mode, actions }: Props) {
  const { request, summary } = presentation;
  const title = mode === 'creation_review' || !request.name ? 'Review request' : `Request ${request.name}`;
  const subtitle = subtitleOf(presentation, mode);
  const noteBy = [request.details_by, formatStamp(request.details_at)].filter(Boolean).join(' · ');

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex flex-col items-start justify-between gap-3 px-5 pb-4 pt-5 sm:px-6 md:flex-row">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {request.badges.map((badge) => (
              <span key={badge.label} className={badgeClass(badge.tone)}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      <div className="space-y-3 border-t border-slate-100 px-5 py-5 sm:px-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Cell label="Customer" value={request.customer_name || request.customer} />
          <Cell label="Requested by" value={request.requester_name || request.requester || '—'} />
          <Cell label="Requested date" value={formatDate(request.requested_date) ?? '—'} />
          <Cell label="Priority" value={request.priority} />
          <Cell label="People" value={summary.people} />
          <Cell label="Action groups" value={presentation.action_groups.length} />
        </div>

        {request.details ? (
          <div className="rounded-xl bg-blue-50/50 px-4 py-3 ring-1 ring-blue-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-blue-800">Request note</p>
              {noteBy && <p className="text-[11px] text-slate-500">{noteBy}</p>}
            </div>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{request.details}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50/70 px-4 py-2.5 ring-1 ring-slate-200/60">
            <p className="text-xs font-semibold text-slate-600">Request note</p>
            <p className="text-xs text-slate-400">No request note.</p>
          </div>
        )}
      </div>
    </section>
  );
}
