import React, { useEffect, useState } from 'react';
import { AlertCircle, Mail, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import Avatar from '@/shared/components/Avatar';
import { useInvoiceRecipients } from '../hooks/useBilling';

type Props = {
  open: boolean;
  run: string;
  /** what the button says, since the same choice precedes an invoice and a credit note */
  confirmLabel: string;
  busy?: boolean;
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
  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
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

/**
 * Who is told that this invoice went out.
 *
 * The named billing contact is the one the notice is addressed to, ticked to begin with
 * because that is what naming them meant. Anyone else chosen is copied, and the list only
 * ever holds this company's own accounts — the server checks the same thing again, so an
 * address that was never offered cannot be slipped in.
 */
const NotifyRecipientsModal: React.FC<Props> = ({
  open,
  run,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}) => {
  const recipients = useInvoiceRecipients(open ? run : undefined);
  const [chosen, setChosen] = useState<string[]>([]);

  const named = recipients.data?.billing_contact;
  const others = recipients.data?.portal_users ?? [];

  useEffect(() => {
    if (!open) return;
    setChosen(named?.email ? [named.email] : []);
  }, [open, named?.email]);

  const toggle = (email: string, on: boolean) =>
    setChosen((current) =>
      on ? [...current, email] : current.filter((address) => address !== email)
    );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      icon={Mail}
      tone="blue"
      title="Who should be told?"
      subtitle="The billing contact is written to; anyone else chosen is copied."
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
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
            disabled={busy || recipients.isLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {chosen.length === 0 ? `${confirmLabel} without telling anyone` : confirmLabel}
          </button>
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
                  {named?.refusal ?? 'No billing contact is named for this company.'}
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

          {chosen.length === 0 && (
            <p className="text-xs text-slate-500">
              Nobody is ticked, so no notice goes out. The invoice is posted all the same.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

export default NotifyRecipientsModal;
