import React, { useState } from 'react';
import { AlertCircle, Ban, Clock, Check, Hourglass, RotateCcw, TriangleAlert } from 'lucide-react';
import type { WorkCard } from '@/lib/api/internal';
import {
  useBlockWorkItem,
  useCancelWorkItem,
  useFailWorkItem,
  useResumeWorkItem,
} from '../hooks/useRequests';

type Props = {
  card: WorkCard;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
};

const BADGE: Record<string, string> = {
  Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Awaiting Verification': 'border-amber-200 bg-amber-50 text-amber-700',
  Blocked: 'border-orange-200 bg-orange-50 text-orange-700',
  Failed: 'border-red-200 bg-red-50 text-red-700',
  Cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
};

/**
 * The frame every unit of work shares: what it is, where it stands, and the two things that
 * can be said about work that will not go through. Nothing here navigates anywhere.
 */
const WorkCardShell: React.FC<Props> = ({ card, title, subtitle, children }) => {
  const [reasonFor, setReasonFor] = useState<'block' | 'fail' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const block = useBlockWorkItem();
  const fail = useFailWorkItem();
  const cancel = useCancelWorkItem();
  const resume = useResumeWorkItem();

  const busy = block.isLoading || fail.isLoading || cancel.isLoading || resume.isLoading;
  const error = (block.error ?? fail.error ?? cancel.error ?? resume.error) as Error | undefined;
  const settled = card.status === 'Completed' || card.status === 'Cancelled';
  const heldUp = card.status === 'Blocked' || card.status === 'Failed';

  const send = async () => {
    if (!reason.trim()) return;
    const payload = { work_order: card.name, reason: reason.trim() };

    try {
      if (reasonFor === 'block') await block.mutateAsync(payload);
      else if (reasonFor === 'fail') await fail.mutateAsync(payload);
      else await cancel.mutateAsync(payload);

      setReasonFor(null);
      setReason('');
    } catch {
      // the message is shown in place and the box stays open to be tried again
    }
  };

  return (
    <div
      className={`rounded-xl border p-4 ${
        card.status === 'Completed' ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">{title}</p>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
            BADGE[card.status] ?? 'border-slate-200 bg-white text-slate-600'
          }`}
        >
          {card.status === 'Completed' && <Check size={12} />}
          {card.status === 'Awaiting Verification' && <Hourglass size={12} />}
          {card.status === 'Blocked' && <Ban size={12} />}
          {card.status === 'Failed' && <TriangleAlert size={12} />}
          {card.status}
        </span>
      </div>

      {card.assigned_technician_name && (
        <p className="mt-1 text-xs text-slate-400">Assigned to {card.assigned_technician_name}</p>
      )}

      {!card.ready && !settled && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-500">
          <Clock size={12} />
          Waiting for {card.waiting_on}
        </p>
      )}

      {heldUp && card.failure_reason && (
        <p className="mt-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-800">
          {card.failure_reason}
        </p>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {error.message}
        </p>
      )}

      {card.ready && !settled && !heldUp && children}

      {heldUp && (
        <button
          type="button"
          disabled={busy}
          onClick={() => resume.mutate({ work_order: card.name })}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          <RotateCcw size={13} />
          Resume work
        </button>
      )}

      {!settled && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {!heldUp && (
            <>
              <button
                type="button"
                onClick={() => setReasonFor('block')}
                className="text-xs font-semibold text-slate-500 transition-colors hover:text-orange-700"
              >
                Block
              </button>
              <button
                type="button"
                onClick={() => setReasonFor('fail')}
                className="text-xs font-semibold text-slate-500 transition-colors hover:text-red-700"
              >
                Mark failed
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setReasonFor('cancel')}
            className="text-xs font-semibold text-slate-500 transition-colors hover:text-red-700"
          >
            Give this up
          </button>
        </div>
      )}

      {reasonFor && (
        <div className="mt-2">
          <textarea
            rows={2}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label={`Reason to ${reasonFor} this work`}
            placeholder="A reason is required and stays on the record."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={!reason.trim() || busy}
              onClick={send}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-900 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => {
                setReasonFor(null);
                setReason('');
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkCardShell;
