import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, CircleAlert, Laptop, TriangleAlert, UserRound, X } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import type { RequestDetail, RequestDetailLine } from '@/lib/api/internal';
import { useSetLineStatus, useSetLineStatuses } from '../../hooks/useRequests';
import PersonHeader from './PersonHeader';
import {
  btnAccept,
  btnPrimary,
  btnReject,
  bulkBar,
  lineRow,
  nextBar,
  pill,
  subjectCard,
  warnBar,
} from '../../lib/fulfilmentStyles';

type Props = {
  request: RequestDetail;
  onContinue: () => void;
  onRejectRequest: () => void;
  continuing: boolean;
};

// a machine still to be prepared names its person as the one it is requested for
const personKey = (line: RequestDetailLine) =>
  line.client_user ||
  line.requested_for_user ||
  line.device_holder ||
  `new:${line.new_user_full_name ?? line.idx}`;

const personName = (line: RequestDetailLine) =>
  (line.is_new_user && !line.client_user ? line.new_user_full_name : line.client_user_name) ||
  line.device_holder ||
  'Unnamed person';

const serviceOf = (line: RequestDetailLine) => line.requested_service_name || line.requested_service;
const actOf = (line: RequestDetailLine) => line.action_label || line.action;

/**
 * Step 1: which of the lines the customer asked for Nexgen will carry out. Nothing runs here.
 *
 * A group decision is offered where several lines plainly call for the same one; it is still
 * written line by line, and the page says which lines took it.
 */
const LineReview: React.FC<Props> = ({ request, onContinue, onRejectRequest, continuing }) => {
  const one = useSetLineStatus();
  const many = useSetLineStatuses();
  const [rejecting, setRejecting] = useState<RequestDetailLine | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const lines = request.lines;
  const decidable = request.can_decide_lines;
  const pending = lines.filter((line) => line.line_status === 'Pending');
  const accepted = lines.filter((line) => line.line_status === 'Approved');
  const rejected = lines.filter((line) => line.line_status === 'Rejected');
  const check = (idx: number) => request.review?.lines.find((row) => row.idx === idx);

  const people = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; isNew: boolean; first: RequestDetailLine; lines: RequestDetailLine[] }>();

    for (const line of lines) {
      const key = personKey(line);
      const group = groups.get(key) ?? {
        key,
        name: personName(line),
        isNew: key.startsWith('new:'),
        first: line,
        lines: [],
      };
      group.lines.push(line);
      groups.set(key, group);
    }

    return [...groups.values()];
  }, [lines]);

  // the same act on the same service, still waiting, for more than one person
  const shared = useMemo(() => {
    const byAct = new Map<string, RequestDetailLine[]>();

    for (const line of pending) {
      const key = `${line.requested_service}|${line.action_label || line.action}`;
      byAct.set(key, [...(byAct.get(key) ?? []), line]);
    }

    return [...byAct.values()].filter((group) => group.length > 1);
  }, [pending]);

  const decideMany = async (group: RequestDetailLine[]) => {
    setNotice(null);
    try {
      const outcome = await many.mutateAsync({
        name: request.name,
        idxs: group.map((line) => line.idx),
        line_status: 'Approved',
      });
      if (outcome.failed) {
        setNotice(
          `${outcome.decided} accepted, ${outcome.failed} not: ` +
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
    if (!rejecting || !reason.trim()) return;
    try {
      await one.mutateAsync({
        name: request.name,
        idx: rejecting.idx,
        line_status: 'Rejected',
        reason: reason.trim(),
      });
      setRejecting(null);
      setReason('');
    } catch {
      // shown in the dialog
    }
  };

  const error = (one.error ?? many.error) as Error | undefined;

  return (
    <div className="space-y-4">
      {/* <div className={banner}>
        <p className="font-semibold">Technician decision</p>
        <p className="mt-0.5">
          Nothing is executed at this stage. You are deciding which requested lines enter the
          work plan.
        </p>
      </div> */}

      {decidable && pending.length > 0 && (
        <div className={bulkBar}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Group decisions</p>
            <p className="text-xs text-slate-500">
              Useful when several lines clearly call for the same decision.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {shared.map((group) => (
              <button
                key={`${group[0].requested_service}|${group[0].action}`}
                type="button"
                disabled={many.isLoading}
                onClick={() => decideMany(group)}
                className={btnAccept}
              >
                Accept {group.length} {serviceOf(group[0])} lines
              </button>
            ))}
            <button
              type="button"
              disabled={many.isLoading}
              onClick={() => decideMany(pending)}
              className={btnAccept}
            >
              Accept all pending
            </button>
          </div>
        </div>
      )}

      {shared.map((group) => (
        <div
          key={`shared-${group[0].requested_service}|${group[0].action}`}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3"
        >
          <p className="text-sm font-semibold text-slate-900">
            Grouped request · {serviceOf(group[0])}
          </p>
          <p className="text-xs text-slate-500">
            {actOf(group[0])} for {group.length} people.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {group.map((line) => (
              <span key={line.idx} className={pill('slate')}>
                {personName(line)}
              </span>
            ))}
          </div>
        </div>
      ))}

      {notice && <p className={warnBar}>{notice}</p>}
      {error && !rejecting && (
        <p className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error.message}
        </p>
      )}

      {people.map((person) => (
        <div key={person.key} className={subjectCard}>
          <PersonHeader
            fullName={person.name}
            isNew={person.isNew}
            facts={person.isNew ? null : request.people?.[person.key]}
            asked={{
              department: person.first.new_user_department,
              email: person.first.new_user_email,
              username: person.first.new_user_username,
            }}
          />

          {person.lines.map((line) => {
            const onDevice = Boolean(line.managed_device || line.is_new_device);
            const rate = check(line.idx);

            return (
              <div
                key={line.idx}
                className={`${lineRow} ${
                  line.line_status === 'Approved'
                    ? 'bg-emerald-50/30'
                    : line.line_status === 'Rejected'
                      ? 'bg-red-50/30'
                      : 'bg-white'
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    line.line_status === 'Rejected'
                      ? 'border-red-200 bg-red-50 text-red-600'
                      : line.line_status === 'Approved'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  {onDevice ? <Laptop size={16} /> : <UserRound size={16} />}
                </span>

                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {serviceOf(line)} · {actOf(line)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {person.name} · {onDevice ? 'Device' : 'User'} scope
                    {onDevice
                      ? ` · ${line.device_hostname || (line.is_new_device ? 'device to be prepared' : 'device')}`
                      : ''}
                  </p>
                  {rate && (
                    <p
                      className={`mt-0.5 inline-flex items-center gap-1 text-xs ${
                        rate.priced ? 'text-slate-500' : 'text-amber-700'
                      }`}
                    >
                      {rate.priced ? <Check size={12} /> : <CircleAlert size={12} />}
                      {rate.priced
                        ? request.review?.shows_rates && rate.rate !== null
                          ? `Rate ${rate.rate.toLocaleString()} ${request.review.currency ?? ''}`
                          : 'Rate set in contract'
                        : 'No rate — delivered but never billed'}
                      {rate.duplicate ? ` · already held (${rate.duplicate})` : ''}
                    </p>
                  )}
                  <p
                    className={`mt-1 text-xs font-semibold ${
                      line.line_status === 'Approved'
                        ? 'text-emerald-700'
                        : line.line_status === 'Rejected'
                          ? 'text-red-700'
                          : 'text-amber-700'
                    }`}
                  >
                    {line.line_status === 'Approved'
                      ? 'Accepted for execution'
                      : line.line_status === 'Rejected'
                        ? `Rejected${line.rejection_reason ? ` · ${line.rejection_reason}` : ''}`
                        : 'Decision required'}
                  </p>
                </div>

                {decidable && (
                  <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-auto">
                    {line.line_status !== 'Approved' && (
                      <button
                        type="button"
                        disabled={one.isLoading}
                        onClick={() =>
                          one.mutate({ name: request.name, idx: line.idx, line_status: 'Approved' })
                        }
                        className={btnAccept}
                      >
                        <Check size={13} />
                        Accept
                      </button>
                    )}
                    {line.line_status !== 'Rejected' && (
                      <button
                        type="button"
                        onClick={() => {
                          setReason('');
                          setRejecting(line);
                        }}
                        className={btnReject}
                      >
                        <X size={13} />
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {decidable &&
        (pending.length === 0 ? (
          <div className={nextBar}>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Line review complete</p>
              <p className="text-xs text-emerald-700">
                {accepted.length} accepted · {rejected.length} rejected
              </p>
            </div>
            {accepted.length > 0 ? (
              <button type="button" disabled={continuing} onClick={onContinue} className={btnPrimary}>
                Continue to Execute
              </button>
            ) : (
              <button type="button" onClick={onRejectRequest} className={btnReject}>
                Reject request
              </button>
            )}
          </div>
        ) : (
          <p className={warnBar}>Every request line needs a decision before execution can start.</p>
        ))}

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
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReject}
              disabled={!reason.trim() || one.isLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Reject line
            </button>
          </div>
        }
      >
        {rejecting && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-semibold">
              {serviceOf(rejecting)} · {actOf(rejecting)}
            </span>
            <br />
            {personName(rejecting)}
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
    </div>
  );
};

export default LineReview;
