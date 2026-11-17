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
  const [confirming, setConfirming] = useState<'link' | 'not_sent' | null>(null);
  const [retry, setRetry] = useState<'scheduled' | 'manual' | null>(null);
  const noteId = useId();

  useEffect(() => {
    setChosen(null);
    setNote('');
    setNoteMissing(false);
    setConfirming(null);
    setRetry(null);
    resolve.reset();
    // resolve.reset is stable per mutation; the panel state must restart per delivery only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const settle = (decision: 'link' | 'not_sent') => {
    const trimmed = note.trim();
    if (!dispatch) return;
    if (!trimmed) {
      setNoteMissing(true);
      setConfirming(null);
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
        onSuccess: (result) => {
          setConfirming(null);
          if (decision === 'not_sent' && result.retry) {
            setRetry(result.retry);
            return;
          }
          onClose();
        },
        onError: () => setConfirming(null),
      }
    );
  };

  const data = evidence.data;
  const delivery = data?.dispatch;
  const candidates = data?.candidates ?? [];
  const chosenEntry = candidates.find((entry) => entry.email_queue === chosen);
  const facts: [string, string][] = delivery
    ? [
        ['Rule', delivery.rule_label],
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
        ['Why it stopped', delivery.reason_label || '—'],
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
          data && !retry && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={!chosen || resolve.isLoading}
                onClick={() => {
                  if (!note.trim()) {
                    setNoteMissing(true);
                    return;
                  }
                  setConfirming('link');
                }}
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
                  setConfirming('not_sent');
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
        ) : retry ? (
          <div className="space-y-4">
            <Message title="Recorded as not sent">
              {retry === 'scheduled'
                ? 'The reminder scheduler will raise this delivery again.'
                : 'Nothing will resend this on its own — repeat the action that sends it.'}
            </Message>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
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
                A matched entry carries this delivery&apos;s own mark. The others could be this delivery&apos;s email but are not proof; message content is not shown.
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
                          <td className="px-3 py-2 text-sm font-medium text-slate-800">
                            {entry.email_queue}
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              {entry.matched ? 'Matched' : 'Unmatched'}
                            </span>
                          </td>
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

      {confirming === 'link' ? (
        <ConfirmModal
          open
          tone="warning"
          title="Attach this queue entry?"
          description="This cannot be undone from this screen, and the delivery history will report this entry's mail as this delivery's."
          confirmLabel="Attach this queue entry"
          loading={resolve.isLoading}
          onConfirm={() => settle('link')}
          onCancel={() => setConfirming(null)}
        >
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-500">Delivery</dt>
              <dd className="break-words text-slate-800">
                {delivery?.rule_label} to {delivery?.recipient || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Queue entry</dt>
              <dd className="break-words text-slate-800">
                {chosenEntry?.email_queue} · {chosenEntry?.status || '—'} · {chosenEntry?.reference || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Your note, recorded under your name</dt>
              <dd className="whitespace-pre-line break-words text-slate-800">{note.trim()}</dd>
            </div>
          </dl>
        </ConfirmModal>
      ) : (
        <ConfirmModal
          open={confirming === 'not_sent'}
          tone="warning"
          title="Record that nothing was sent?"
          description="This records that nothing was sent and makes the delivery owed again. It does not send anything by itself."
          confirmLabel="Record that nothing was sent"
          loading={resolve.isLoading}
          onConfirm={() => settle('not_sent')}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
};

export default InvestigateDelivery;
