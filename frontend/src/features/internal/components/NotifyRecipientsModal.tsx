import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Mail, Paperclip, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import Avatar from '@/shared/components/Avatar';
import { Pill } from './billing/ui';
import { day, money } from './billing/format';
import { useInvoiceEmailRecipients, useInvoiceRecipients } from '../hooks/useBilling';

type Props = {
  open: boolean;
  /** the run whose notice is being addressed… */
  run?: string;
  /** …or an invoice sent on its own, which needs no run at all */
  invoice?: string;
  /** what the button says, since the same choice precedes an invoice, a credit note or a resend */
  confirmLabel: string;
  title?: string;
  subtitle?: string;
  /** an invoice sent to nobody is not a send; a run may be submitted telling no one */
  requireRecipient?: boolean;
  busy?: boolean;
  /** what the server answered: queued, or why nothing went out */
  result?: string | null;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (recipients: string[]) => void;
};

const Line: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  name: string;
  email: string;
  note?: string;
}> = ({ checked, onChange, name, email, note }) => (
  <label
    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
      checked
        ? 'border-blue-200 bg-blue-50/60 ring-1 ring-blue-100'
        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 shrink-0 rounded border-slate-300"
    />
    <Avatar name={name} />
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold text-slate-800">{name}</span>
      <span className="block truncate text-xs text-slate-500">{email}</span>
    </span>
    {note && (
      <span className="ml-auto shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
        {note}
      </span>
    )}
  </label>
);

const STATES: Record<string, 'amber' | 'green' | 'red'> = {
  Queued: 'amber',
  Sent: 'green',
  Failed: 'red',
};

/**
 * Who this invoice goes to.
 *
 * One choice for the notice that follows a billing run and for an invoice sent again on
 * its own, because it is the same decision: the named billing contact is who the document
 * is addressed to, ticked to begin with because that is what naming them meant, and
 * anyone else chosen is copied. The list only ever holds this company's own accounts —
 * nothing is typed in here, and the server checks the same list again, so an address that
 * was never offered cannot be slipped in.
 *
 * Opened on an invoice it also says which document is about to leave, what is attached to
 * it, and what was already sent and became of it.
 */
const NotifyRecipientsModal: React.FC<Props> = ({
  open,
  run,
  invoice,
  confirmLabel,
  title = 'Who should be told?',
  subtitle = 'The billing contact is written to; anyone else chosen is copied.',
  requireRecipient = false,
  busy,
  result,
  error,
  onCancel,
  onConfirm,
}) => {
  const ofRun = useInvoiceRecipients(open && !invoice ? run : undefined);
  const ofInvoice = useInvoiceEmailRecipients(open && invoice ? invoice : undefined);
  const recipients = invoice ? ofInvoice : ofRun;
  const document = ofInvoice.data;
  const [chosen, setChosen] = useState<string[]>([]);

  const named = recipients.data?.billing_contact;
  const others = recipients.data?.portal_users ?? [];
  const copies = chosen.filter((address) => address !== named?.email);

  useEffect(() => {
    if (!open) return;
    setChosen(named?.email ? [named.email] : []);
  }, [open, named?.email]);

  const toggle = (email: string, on: boolean) =>
    setChosen((current) =>
      on ? [...current, email] : current.filter((address) => address !== email)
    );

  const nobody = chosen.length === 0;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      icon={Mail}
      tone="blue"
      title={title}
      subtitle={subtitle}
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {nobody
              ? 'Nobody chosen'
              : `1 addressed${copies.length ? ` · ${copies.length} copied` : ''}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(chosen)}
              disabled={busy || recipients.isLoading || (requireRecipient && nobody)}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? 'Sending…'
                : nobody && !requireRecipient
                  ? `${confirmLabel} without telling anyone`
                  : confirmLabel}
            </button>
          </div>
        </div>
      }
    >
      {recipients.isLoading ? (
        <p className="text-sm text-slate-500">Reading who can be told…</p>
      ) : recipients.error instanceof Error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm font-medium text-red-700">{recipients.error.message}</span>
        </div>
      ) : (
        <div className="space-y-4">
          {document && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-slate-800">
                  {document.invoice}
                </span>
                {document.is_return && <Pill tone="purple">Credit / Return</Pill>}
                <span className="ml-auto text-sm font-bold text-slate-800">
                  {money(document.grand_total, document.currency)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {document.customer_name || document.customer} · {document.period} · posted{' '}
                {day(document.posting_date)}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Paperclip size={13} className="shrink-0 text-slate-400" />
                {document.pdf.filename}
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Billing contact
            </p>
            {named?.email ? (
              <Line
                checked={chosen.includes(named.email)}
                onChange={(on) => toggle(named.email as string, on)}
                name={named.full_name || named.email}
                email={named.email}
                note="Addressed to"
              />
            ) : (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
                <span className="text-sm text-amber-800">
                  {named?.refusal ?? 'No billing contact is named for this company.'}{' '}
                  Choose below who this goes to.
                </span>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Copy to
            </p>
            {others.length === 0 ? (
              <p className="text-sm text-slate-400">
                This company has no portal account to copy.
              </p>
            ) : (
              <div className="space-y-2">
                {others.map((row) => (
                  <Line
                    key={row.email}
                    checked={chosen.includes(row.email)}
                    onChange={(on) => toggle(row.email, on)}
                    name={row.full_name}
                    email={row.email}
                  />
                ))}
              </div>
            )}
          </div>

          {nobody && !requireRecipient && (
            <p className="text-xs text-slate-500">
              Nobody is ticked, so no notice goes out. The invoice is posted all the same.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <span className="text-sm font-medium text-red-700">{error}</span>
            </div>
          )}

          {result && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-800">{result}</span>
            </div>
          )}

          {!!document?.attempts.length && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Previous sends
              </p>
              <div className="space-y-1.5">
                {document.attempts.map((attempt) => (
                  <div
                    key={attempt.attempt ?? `${attempt.on}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <Pill tone={STATES[attempt.state] ?? 'gray'}>{attempt.state}</Pill>
                    <span className="min-w-0 truncate text-slate-700">
                      {attempt.to.join(', ') || '—'}
                    </span>
                    <span className="ml-auto shrink-0 text-slate-400">
                      {attempt.by} · {String(attempt.on ?? '').slice(0, 16)}
                    </span>
                    {attempt.error && (
                      <span className="w-full text-rose-700">{attempt.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default NotifyRecipientsModal;
