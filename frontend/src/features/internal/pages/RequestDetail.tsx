import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, CircleAlert, TriangleAlert, X } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import StatusBadge from '@/shared/components/StatusBadge';
import RequestProgressStepper from '../components/RequestProgressStepper';
import RequestWorkbench from '../components/RequestWorkbench';
import {
  useRequestDetail,
  useRequestExecutionPlan,
  useRunRequestAction,
  useSetLineStatus,
} from '../hooks/useRequests';
import type { RequestDetailLine } from '@/lib/api/internal';
import RequestLinesByPerson, { type PersonLine } from '@/shared/components/RequestLinesByPerson';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');
const fmtStamp = (value?: string | null) =>
  value ? String(value).slice(0, 16).replace('T', ' ') : null;

// the review is still being written: everything after it belongs to the workbench
const UNDER_REVIEW = ['Submitted', 'Under Review'];

/** A line as the technician reads it: the person first, then what was asked for them. */
const asPersonLine = (line: RequestDetailLine, extra?: React.ReactNode): PersonLine => {
  // a device line names nobody, but the machine has a holder and that is who it is about
  const person = line.client_user || line.device_holder;
  // "new" only until the record exists: a line linked to a person is about them
  const isNewUser = Boolean(line.is_new_user) && !person;

  return {
    idx: line.idx,
    person,
    personName: isNewUser ? line.new_user_full_name : line.client_user_name,
    isNewUser,
    username: isNewUser ? line.new_user_username : line.client_username,
    department: isNewUser ? line.new_user_department : line.client_user_department,
    email: line.new_user_email,
    action: line.action,
    actionLabel: line.action_label,
    service: line.requested_service_name || line.requested_service,
    onDevice: Boolean(line.managed_device || line.is_new_device),
    serviceScope: line.service_scope,
    isNewDevice: Boolean(line.is_new_device),
    deviceName: line.is_new_device ? line.new_device_label : line.device_hostname,
    serial: line.is_new_device ? line.new_device_serial : line.device_serial,
    deviceType: line.is_new_device ? line.new_device_type : line.device_type,
    requestedFor: line.requested_effective_date,
    status: line.line_status,
    comment: line.comment,
    rejectionReason: line.rejection_reason,
    extra,
  };
};

type ReasonPrompt = { kind: 'action'; action: string; label: string } | { kind: 'line'; idx: number };

export default function RequestDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useRequestDetail(name);
  const runAction = useRunRequestAction();
  const setLine = useSetLineStatus();

  const [prompt, setPrompt] = useState<ReasonPrompt | null>(null);
  const [reason, setReason] = useState('');

  const data = detail.data;
  const reviewing = Boolean(data && UNDER_REVIEW.includes(data.status));
  const plan = useRequestExecutionPlan(data && !reviewing ? name : undefined);
  const actionError = (runAction.error ?? setLine.error) as Error | undefined;

  // a dispute is handled on the invoice it contests, so a direct link lands there
  useEffect(() => {
    if (data?.billing_run) navigate(`/msp/billing/${data.billing_run}`, { replace: true });
  }, [data?.billing_run, navigate]);

  const openPrompt = (next: ReasonPrompt) => {
    setReason('');
    setPrompt(next);
  };

  const confirmPrompt = async () => {
    if (!prompt || !reason.trim()) return;

    try {
      if (prompt.kind === 'action') {
        await runAction.mutateAsync({ name, action: prompt.action, reason: reason.trim() });
      } else {
        await setLine.mutateAsync({
          name,
          idx: prompt.idx,
          line_status: 'Rejected',
          reason: reason.trim(),
        });
      }
      setPrompt(null);
    } catch {
      // the mutation error is rendered in place; keep the prompt open so it can be retried
    }
  };

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'Request not found.'}
        </div>
      </div>
    );
  }

  const review = data.review;
  const checkFor = (idx: number) => review?.lines.find((row) => row.idx === idx);
  const decided = data.lines.filter((line) => line.line_status !== 'Pending');
  const allDecided = decided.length === data.lines.length && data.lines.length > 0;
  const anyApproved = data.lines.some((line) => line.line_status === 'Approved');

  // the header keeps only what ends a request early; the rest lives where the work is
  const headerActions = data.available_actions.filter((action) =>
    ['reject', 'cancel'].includes(action.action)
  );

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/requests')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to requests
      </button>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">{data.name}</h1>
              <StatusBadge value={data.status} />
              <StatusBadge value={data.priority} />
              <StatusBadge value={data.request_type} />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {data.customer} · raised via {data.source} on {fmtDate(data.creation)}
              {data.requester_name || data.requester
                ? ` by ${data.requester_name ?? data.requester}`
                : ''}
            </p>
            {data.rejection_reason && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {data.rejection_reason}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {headerActions.map((action) => (
              <button
                key={action.action}
                type="button"
                disabled={runAction.isLoading}
                onClick={() =>
                  openPrompt({ kind: 'action', action: action.action, label: action.label })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {data.reviewed_by && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-3 text-xs text-slate-500">
            Reviewed by {data.reviewed_by}
            {fmtStamp(data.reviewed_at) ? ` · ${fmtStamp(data.reviewed_at)}` : ''}
          </div>
        )}

        {review && !review.contract_active && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              {review.has_contract
                ? `This customer's contract is ${String(review.contract_status).toLowerCase()}, not active.`
                : 'This customer has no contract yet — nothing here can be billed.'}
            </p>
          </div>
        )}

        {actionError && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{actionError.message}</span>
          </div>
        )}

        {reviewing ? (
          <>
            <RequestProgressStepper
              current="review"
              stages={[
                { key: 'review', label: 'Review', done: false, needed: true, state: 'current' },
                { key: 'prepare', label: 'Prepare', done: false, needed: true, state: 'todo' },
                { key: 'execute', label: 'Execute', done: false, needed: true, state: 'todo' },
                { key: 'verify', label: 'Verify', done: false, needed: true, state: 'todo' },
                { key: 'complete', label: 'Complete', done: false, needed: true, state: 'todo' },
              ]}
            />

            <div className="px-6 py-5">
              <RequestLinesByPerson
                lines={data.lines.map((line) => {
                  const check = checkFor(line.idx);

                  return asPersonLine(
                    line,
                    check && (
                      <p
                        className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${
                          check.priced ? 'text-slate-500' : 'text-amber-700'
                        }`}
                      >
                        {check.priced ? <Check size={12} /> : <CircleAlert size={12} />}
                        {check.priced
                          ? review?.shows_rates && check.rate !== null
                            ? `Rate ${check.rate.toLocaleString()} ${review.currency ?? ''}`
                            : 'Rate set in contract'
                          : 'No rate — delivered but never billed'}
                        {check.duplicate ? ` · already held (${check.duplicate})` : ''}
                      </p>
                    )
                  );
                })}
                rowActions={
                  data.can_decide_lines
                    ? (line) =>
                        line.status === 'Pending' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setLine.mutate({ name, idx: line.idx, line_status: 'Approved' })
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                            >
                              <Check size={13} />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => openPrompt({ kind: 'line', idx: line.idx })}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                            >
                              <X size={13} />
                              Reject
                            </button>
                          </>
                        )
                    : undefined
                }
              />

              {allDecided && data.can_decide_lines && (
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                  <p className="text-sm text-slate-500">
                    {data.lines.filter((line) => line.line_status === 'Approved').length} approved ·{' '}
                    {data.lines.filter((line) => line.line_status === 'Rejected').length} rejected
                  </p>
                  {anyApproved ? (
                    <button
                      type="button"
                      disabled={runAction.isLoading}
                      onClick={() => runAction.mutate({ name, action: 'approve' })}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
                    >
                      Approve request and prepare work
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        openPrompt({ kind: 'action', action: 'reject', label: 'Reject request' })
                      }
                      className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                    >
                      Reject request
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : plan.data ? (
          <RequestWorkbench plan={plan.data} />
        ) : (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            {plan.error ? (plan.error as Error).message : 'Loading the work…'}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(prompt)}
        onClose={() => setPrompt(null)}
        icon={TriangleAlert}
        tone="red"
        title={prompt?.kind === 'line' ? `Reject line ${prompt.idx}` : prompt?.label ?? ''}
        subtitle="A reason is required and stays on the record."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPrompt}
              disabled={!reason.trim() || runAction.isLoading || setLine.isLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirm
            </button>
          </div>
        }
      >
        {actionError && (
          <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{actionError.message}</span>
          </div>
        )}

        <textarea
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain the decision…"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </Modal>
    </div>
  );
}
