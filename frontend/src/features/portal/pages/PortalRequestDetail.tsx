import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CircleCheck, CircleX, Clock, Quote, ShieldCheck } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import { useDecideRequest, useServiceRequest } from '../hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const OUTCOME = {
  Approved: {
    icon: CircleCheck,
    className: 'border-emerald-100 bg-emerald-50/60',
    iconClass: 'text-emerald-600',
    label: 'Accepted',
  },
  Rejected: {
    icon: CircleX,
    className: 'border-red-100 bg-red-50/60',
    iconClass: 'text-red-600',
    label: 'Declined',
  },
  Pending: {
    icon: Clock,
    className: 'border-amber-100 bg-amber-50/60',
    iconClass: 'text-amber-600',
    label: 'Being reviewed',
  },
} as const;

export default function PortalRequestDetail() {
  const { name = '' } = useParams();
  const decide = useDecideRequest();
  const [reason, setReason] = useState('');
  const [refusing, setRefusing] = useState(false);
  const navigate = useNavigate();
  const { data, isLoading, error } = useServiceRequest(name);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(error as Error)?.message || 'Request not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to dashboard
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-lg font-bold text-slate-900">{data.name}</h1>
          <StatusBadge value={data.status} />
          <StatusBadge value={data.priority} />
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Submitted on {fmtDate(data.creation)} · {data.lines.length} item
          {data.lines.length > 1 ? 's' : ''}
        </p>

        {data.rejection_reason && (
          <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
              Nexgen's answer
            </p>
            <p className="mt-1.5 text-sm text-red-800">{data.rejection_reason}</p>
          </div>
        )}

        {data.reviewed_on && (
          <p className="mt-4 text-xs text-slate-500">
            Reviewed by Nexgen on {fmtDate(data.reviewed_on)}
          </p>
        )}

        {data.status === 'Awaiting Customer Approval' && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            {data.can_decide ? (
              <>
                <p className="text-sm font-semibold text-amber-900">
                  This request is waiting for your accord
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  It reaches Nexgen only once you have approved it. Nothing is provisioned or
                  billed before that.
                </p>

                {decide.error instanceof Error && (
                  <p className="mt-3 flex items-start gap-2 text-sm font-medium text-red-700">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    {decide.error.message}
                  </p>
                )}

                {refusing && (
                  <textarea
                    rows={2}
                    autoFocus
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why are you refusing? The person who raised it will read this."
                    className="mt-3 w-full resize-y rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                  />
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={decide.isLoading}
                    onClick={() =>
                      refusing
                        ? decide.mutate({ name: data.name, approve: false, reason })
                        : decide.mutate({ name: data.name, approve: true })
                    }
                    className={
                      refusing
                        ? 'inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60'
                        : 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60'
                    }
                  >
                    {refusing ? <CircleX size={15} /> : <ShieldCheck size={15} />}
                    {refusing ? 'Confirm the refusal' : 'Approve and send to Nexgen'}
                  </button>
                  <button
                    type="button"
                    disabled={decide.isLoading}
                    onClick={() => {
                      setRefusing(!refusing);
                      setReason('');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                  >
                    {refusing ? 'Cancel' : 'Refuse it'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-amber-800">
                Waiting for approval inside your company. It reaches Nexgen once someone with
                that right has agreed to it.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {data.lines.map((line) => {
          const outcome = OUTCOME[line.line_status as keyof typeof OUTCOME] ?? OUTCOME.Pending;
          const Icon = outcome.icon;

          return (
            <div
              key={line.idx}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge value={line.action} />
                  <span className="text-sm font-semibold text-slate-900">{line.service_name}</span>
                  <span className="text-sm text-slate-500">
                    for {line.user_name || 'a new user'}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${outcome.iconClass}`}
                >
                  <Icon size={14} />
                  {outcome.label}
                </span>
              </div>

              <div className="space-y-4 p-4">
                {line.comment && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
                    <div className="flex items-center gap-2">
                      <Quote size={13} className="text-slate-500" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        What you asked for
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {line.comment}
                    </p>
                  </div>
                )}

                {line.rejection_reason && (
                  <div className={`rounded-lg border p-3.5 ${outcome.className}`}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                      Why this was declined
                    </p>
                    <p className="mt-1.5 text-sm text-red-800">{line.rejection_reason}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium text-slate-400">Department</p>
                    <p className="mt-0.5 text-sm text-slate-700">{line.department || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">Requested for</p>
                    <p className="mt-0.5 text-sm text-slate-700">
                      {fmtDate(line.requested_effective_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">Device</p>
                    <p className="mt-0.5 text-sm text-slate-700">
                      {line.delivered_on ||
                        line.hostname ||
                        (line.is_new_device ? line.new_device_label : null) ||
                        'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">Service live since</p>
                    <p className="mt-0.5 text-sm text-slate-700">
                      {fmtDate(line.service_start_date)}
                    </p>
                  </div>
                </div>

                {line.service_status && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                    <CircleCheck size={14} className="text-emerald-600" />
                    <span className="text-sm text-emerald-800">
                      Delivered — the service is now{' '}
                      <span className="font-semibold">{line.service_status.toLowerCase()}</span>.
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
