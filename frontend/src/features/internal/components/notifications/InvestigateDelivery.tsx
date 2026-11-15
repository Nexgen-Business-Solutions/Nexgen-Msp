import React, { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useDispatchEvidence, useResolveDispatch } from './useNotifications';
import { Field, Message, SkeletonRows } from './ui';
import { fmtMoment } from './format';

type Props = { dispatch: string | null; onClose: () => void };

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'The decision could not be recorded.';

const InvestigateDelivery: React.FC<Props> = ({ dispatch, onClose }) => {
  const evidence = useDispatchEvidence(dispatch);
  const resolve = useResolveDispatch();
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteMissing, setNoteMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();

  useEffect(() => {
    setChosen(null);
    setNote('');
    setNoteMissing(false);
    setConfirming(false);
    resolve.reset();
    // resolve.reset is stable per mutation; the panel state must restart per delivery only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const settle = (decision: 'link' | 'not_sent') => {
    const trimmed = note.trim();
    if (!dispatch) return;
    if (!trimmed) {
      setNoteMissing(true);
      setConfirming(false);
      return;
    }
    resolve.mutate(
      {
        dispatch,
        decision,
        note: trimmed,
        ...(decision === 'link' && chosen ? { email_queue: chosen } : {}),
      },
      {
        onSuccess: () => {
          setConfirming(false);
          onClose();
        },
        onError: () => setConfirming(false),
      }
    );
  };

  const data = evidence.data;
  const delivery = data?.dispatch;
  const candidates = data?.candidates ?? [];
  const facts: [string, string][] = delivery
    ? [
        ['Rule', delivery.rule],
        ['Recipient', delivery.recipient || '—'],
        [
          'Business record',
          [delivery.business_name, delivery.business_doctype && `(${delivery.business_doctype})`]
            .filter(Boolean)
            .join(' ') || '—',
        ],
        ['Iteration', delivery.reminder_iteration == null ? '—' : String(delivery.reminder_iteration)],
        ['Subject', delivery.subject_snapshot || '—'],
        ['Reserved', fmtMoment(delivery.reserved_at) || '—'],
        ['Failure reason', delivery.failure_reason || '—'],
      ]
    : [];

  return (
    <>
      <Modal
        open={Boolean(dispatch)}
        title="Investigate delivery"
        subtitle={dispatch ?? undefined}
        icon={Search}
        tone="amber"
        onClose={onClose}
        widthClass="max-w-3xl"
        footer={
          data && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={!chosen || resolve.isLoading}
                onClick={() => settle('link')}
                className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Attach this queue entry
              </button>
              <button
                type="button"
                disabled={resolve.isLoading}
                onClick={() => {
                  if (!note.trim()) {
                    setNoteMissing(true);
                    return;
                  }
                  setConfirming(true);
                }}
                className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Nothing was sent
              </button>
            </div>
          )
        }
      >
        {evidence.isLoading ? (
          <SkeletonRows rows={4} />
        ) : evidence.isError ? (
          <Message tone="error" title="The evidence could not be loaded">
            {errorText(evidence.error)}
          </Message>
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="break-words text-sm text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-800">Possible queue entries</h3>
              <p className="mb-2 text-xs text-slate-500">
                These entries could be this delivery&apos;s email. They are not proof; message content is not shown.
              </p>
              {candidates.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  No queue entry could match this delivery.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        {['Select', 'Queue entry', 'Status', 'Created', 'Reference'].map((head) => (
                          <th key={head} scope="col" className="px-3 py-2 text-xs font-semibold text-slate-500">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {candidates.map((entry) => (
                        <tr key={entry.email_queue}>
                          <td className="px-3 py-2">
                            <input
                              type="radio"
                              name="queue-entry"
                              aria-label={`Select ${entry.email_queue}`}
                              checked={chosen === entry.email_queue}
                              onChange={() => setChosen(entry.email_queue)}
                              className="h-4 w-4"
                            />
                          </td>
                          <td className="px-3 py-2 text-sm font-medium text-slate-800">{entry.email_queue}</td>
                          <td className="px-3 py-2 text-sm text-slate-600">{entry.status || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-sm tabular-nums text-slate-600">
                            {fmtMoment(entry.created) || '—'}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-600">{entry.reference || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Field
              label="Note (required)"
              htmlFor={noteId}
              hint="Recorded in the audit trail with your name."
            >
              <textarea
                id={noteId}
                rows={3}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setNoteMissing(false);
                }}
                aria-invalid={noteMissing}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </Field>

            {noteMissing && (
              <p role="alert" className="text-sm font-medium text-red-700">
                Write a note explaining your decision before settling this delivery.
              </p>
            )}
            {resolve.isError && (
              <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {errorText(resolve.error)}
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={confirming}
        tone="warning"
        title="Send this notification?"
        description="Recording that nothing was sent puts the delivery back through the normal path, and the recipient will receive the email."
        confirmLabel="Nothing was sent, send it"
        loading={resolve.isLoading}
        onConfirm={() => settle('not_sent')}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
};

export default InvestigateDelivery;
