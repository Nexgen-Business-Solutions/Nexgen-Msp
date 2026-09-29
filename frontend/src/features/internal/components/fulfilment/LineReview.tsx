import React, { useState } from 'react';
import { AlertCircle, Check, TriangleAlert, X } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import type { RequestDetail } from '@/lib/api/internal';
import {
  RequestPresentation,
  type RequestActionGroupPresentation,
  type RequestSubjectPresentation,
  type RequestTargetPresentation,
} from '@/shared/request';
import {
  useInternalRequestPresentation,
  useSetLineStatus,
  useSetLineStatuses,
} from '../../hooks/useRequests';
import PersonHeader from './PersonHeader';
import { btnAccept, btnPrimary, btnReject, warnBar } from '../../lib/fulfilmentStyles';

type Props = {
  request: RequestDetail;
  onContinue: () => void;
  onRejectRequest: () => void;
  continuing: boolean;
};

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

const pendingOf = (group: RequestActionGroupPresentation) =>
  group.targets
    .filter((target) => target.line_status === 'Pending' && target.line_idx !== null)
    .map((target) => target.line_idx as number);

const LineReview: React.FC<Props> = ({ request, onContinue, onRejectRequest, continuing }) => {
  const presentation = useInternalRequestPresentation(request.name);
  const one = useSetLineStatus();
  const many = useSetLineStatuses();
  const [rejecting, setRejecting] = useState<RequestTargetPresentation | null>(null);
  const [rejectingGroup, setRejectingGroup] = useState<RequestActionGroupPresentation | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const lines = request.lines;
  const decidable = request.can_decide_lines;
  const pending = lines.filter((line) => line.line_status === 'Pending');
  const accepted = lines.filter((line) => line.line_status === 'Approved');
  const rejected = lines.filter((line) => line.line_status === 'Rejected');
  const check = (idx: number | null) => request.review?.lines.find((row) => row.idx === idx);

  const decideMany = async (idxs: number[], lineStatus: 'Approved' | 'Rejected', why?: string) => {
    setNotice(null);
    try {
      const outcome = await many.mutateAsync({
        name: request.name,
        idxs,
        line_status: lineStatus,
        ...(why ? { reason: why } : {}),
      });
      if (outcome.failed) {
        const verb = lineStatus === 'Approved' ? 'accepted' : 'rejected';
        setNotice(
          `${outcome.decided} ${verb}, ${outcome.failed} not: ` +
            outcome.results
              .filter((row) => !row.ok)
              .map((row) => `line ${row.idx} — ${row.message}`)
              .join('; ')
        );
      }
    } catch {
      // shown below
    }
  };

  const confirmReject = async () => {
    if (!rejecting || rejecting.line_idx === null || !reason.trim()) return;
    try {
      await one.mutateAsync({
        name: request.name,
        idx: rejecting.line_idx,
        line_status: 'Rejected',
        reason: reason.trim(),
      });
      setRejecting(null);
      setReason('');
    } catch {
      // shown in the dialog
    }
  };

  const personDetail = (subject: RequestSubjectPresentation) => {
    if (subject.type === 'new') {
      const entity = presentation.data?.requested_entities.find((row) => row.key === subject.subject_key);
      const snapshot = entity?.requested_snapshot ?? {};
      return (
        <PersonHeader
          fullName={subject.full_name}
          isNew
          asked={{
            department: subject.department ?? text(snapshot.department),
            email: text(snapshot.email),
            username: text(snapshot.username),
          }}
        />
      );
    }
    return (
      <PersonHeader
        fullName={subject.full_name}
        facts={subject.client_user ? request.people?.[subject.client_user] : null}
      />
    );
  };

  const groupControls = (group: RequestActionGroupPresentation) => {
    const open = pendingOf(group);
    return (
      <>
        <button
          type="button"
          disabled={!open.length || many.isLoading || one.isLoading}
          onClick={() => decideMany(open, 'Approved')}
          className={btnAccept}
        >
          Accept all
        </button>
        <button
          type="button"
          disabled={!open.length || many.isLoading || one.isLoading}
          onClick={() => {
            setReason('');
            setRejectingGroup(group);
          }}
          className={btnReject}
        >
          Reject all
        </button>
      </>
    );
  };

  const targetControls = (target: RequestTargetPresentation) => {
    const rate = check(target.line_idx);
    return (
      <>
        {rate && (rate.priced || rate.duplicate) && (
          <span className={`w-full text-xs ${rate.priced ? 'text-slate-500' : 'text-amber-700'}`}>
            {rate.priced
              ? request.review?.shows_rates && rate.rate !== null
                ? `Rate ${rate.rate.toLocaleString()} ${request.review.currency ?? ''}`
                : 'Rate set in contract'
              : ''}
            {rate.duplicate ? ` · already held (${rate.duplicate})` : ''}
          </span>
        )}
        {target.line_idx !== null && target.line_status !== 'Approved' && (
          <button
            type="button"
            disabled={one.isLoading || many.isLoading}
            onClick={() =>
              one.mutate({ name: request.name, idx: target.line_idx as number, line_status: 'Approved' })
            }
            className={btnAccept}
          >
            <Check size={13} />
            Accept
          </button>
        )}
        {target.line_idx !== null && target.line_status !== 'Rejected' && (
          <button
            type="button"
            onClick={() => {
              setReason('');
              setRejecting(target);
            }}
            className={btnReject}
          >
            <X size={13} />
            Reject
          </button>
        )}
      </>
    );
  };

  if (!presentation.data) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        {presentation.error ? (presentation.error as Error).message : 'Loading the request…'}
      </p>
    );
  }

  const error = (one.error ?? many.error) as Error | undefined;

  return (
    <div className="space-y-4">
      {notice && <p className={warnBar}>{notice}</p>}
      {error && !rejecting && (
        <p className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error.message}
        </p>
      )}

      <RequestPresentation
        presentation={presentation.data}
        mode="internal_review"
        withHeader={false}
        renderPersonDetail={personDetail}
        renderGroupControls={decidable ? groupControls : undefined}
        renderTargetControls={decidable ? targetControls : undefined}
        footer={
          decidable ? (
            <div className="sticky bottom-3 z-10 flex flex-col items-stretch justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-lg sm:flex-row sm:items-center">
              {pending.length > 0 ? (
                <p className="text-xs text-slate-500">Every line must be accepted or rejected before execution.</p>
              ) : (
                <p className="text-xs font-semibold text-slate-700">
                  {accepted.length} accepted · {rejected.length} rejected
                </p>
              )}
              {pending.length > 0 || accepted.length > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {pending.length > 1 && (
                    <button
                      type="button"
                      disabled={many.isLoading || one.isLoading}
                      onClick={() => decideMany(pending.map((line) => line.idx), 'Approved')}
                      className={`${btnAccept} py-2.5`}
                    >
                      Accept all remaining
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={continuing || pending.length > 0}
                    onClick={onContinue}
                    className={`${btnPrimary} py-2.5`}
                  >
                    Continue to Execute
                  </button>
                </div>
              ) : (
                <button type="button" onClick={onRejectRequest} className={`${btnReject} py-2.5`}>
                  Reject request
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        icon={TriangleAlert}
        tone="red"
        title="Reject request line"
        subtitle="A reason is required and stays on the record."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejecting(null)}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReject}
              disabled={!reason.trim() || one.isLoading}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Reject line
            </button>
          </div>
        }
      >
        {rejecting && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-semibold">
              {rejecting.operation_label} · {rejecting.target_label}
            </span>
            {rejecting.person_label && (
              <>
                <br />
                {rejecting.person_label}
              </>
            )}
          </p>
        )}
        {one.error instanceof Error && (
          <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {one.error.message}
          </p>
        )}
        <label htmlFor="reject-reason" className="mb-1.5 block text-xs font-semibold text-slate-700">
          Reason
        </label>
        <textarea
          id="reject-reason"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this line being rejected?"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </Modal>

      <Modal
        open={Boolean(rejectingGroup)}
        onClose={() => {
          setRejectingGroup(null);
          setReason('');
        }}
        icon={TriangleAlert}
        tone="red"
        title="Reject request"
        subtitle="A reason is required and will be visible in the request history."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRejectingGroup(null);
                setReason('');
              }}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reason.trim() || many.isLoading}
              onClick={async () => {
                if (!rejectingGroup) return;

                await decideMany(pendingOf(rejectingGroup), 'Rejected', reason.trim());
                setRejectingGroup(null);
                setReason('');
              }}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Reject request
            </button>
          </div>
        }
      >
        {rejectingGroup && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-semibold">{rejectingGroup.operation_label}</span>
            <br />
            {pendingOf(rejectingGroup).length} line(s) will carry this reason.
          </p>
        )}
        <label
          htmlFor="reject-group-reason"
          className="mb-1.5 block text-xs font-semibold text-slate-700"
        >
          Reason
        </label>
        <textarea
          id="reject-group-reason"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </Modal>
    </div>
  );
};

export default LineReview;
