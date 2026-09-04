import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CircleCheck, CircleX, PencilLine, ShieldCheck } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RequestLinesByPerson, { type PersonLine } from '@/shared/components/RequestLinesByPerson';
import type { PortalRequestLine } from '@/lib/api/portal';
import { useDecideRequest, useServiceRequest } from '../hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

/** A line as the customer reads it back: the person first, then what was asked for them. */
const asPersonLine = (line: PortalRequestLine): PersonLine => {
  const person = line.client_user || line.device_holder;
  const isNewUser = Boolean(line.is_new_user) && !person;

  return {
    idx: line.idx,
    person,
    personName: line.user_name,
    isNewUser,
    username: isNewUser ? line.new_user_username : line.username,
    department: line.department,
    email: line.new_user_email,
    needsPortalAccess: Boolean(line.needs_portal_access),
    action: line.action,
    actionLabel: line.action_label,
    service: line.service_name,
    onDevice: Boolean(line.managed_device || line.is_new_device),
    isNewDevice: Boolean(line.is_new_device),
    deviceName: line.is_new_device ? line.new_device_label : line.hostname,
    serial: line.is_new_device ? line.new_device_serial : line.serial_number,
    deviceType: line.is_new_device ? line.new_device_type : line.device_type,
    requestedFor: line.requested_effective_date,
    status: line.line_status,
    comment: line.comment,
    rejectionReason: line.rejection_reason,
    extra: line.service_status ? (
      <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <CircleCheck size={12} />
        Delivered — {line.service_status.toLowerCase()}
        {line.service_start_date ? ` since ${fmtDate(line.service_start_date)}` : ''}
        {line.delivered_on ? ` on ${line.delivered_on}` : ''}
      </p>
    ) : null,
  };
};

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

        {data.status === 'Rejected' && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-sm text-slate-700">
              This request was declined. You can correct it and send it again as a new request.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/new?from=${encodeURIComponent(data.name)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <PencilLine size={15} />
              Edit and resend
            </button>
          </div>
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
                {data.has_approver
                  ? 'Waiting for approval inside your company. It reaches Nexgen once someone with that right has agreed to it.'
                  : 'Waiting for approval inside your company — but nobody at your company holds the right to approve yet. Ask Nexgen to grant it to the person who decides.'}
              </p>
            )}
          </div>
        )}
      </div>

      <RequestLinesByPerson
        lines={data.lines.map(asPersonLine)}
        noteLabel="What you asked for"
      />
    </div>
  );
}
