import React, { useState } from 'react';
import { AlertCircle, Mail, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import {
  useAddBillingContact,
  useCustomerContacts,
  useSetBillingContact,
} from '../hooks/useCustomerDetails';

type Props = {
  open: boolean;
  customer: string;
  current: string | null;
  onClose: () => void;
};

/**
 * Who at this company is told an invoice was issued.
 *
 * One person, named. Most of the time they already have an account here, so those come
 * first; an accountant who has none is added on the spot, because an invoice notice must
 * not wait on somebody being given a portal login.
 */
const BillingContactModal: React.FC<Props> = ({ open, customer, current, onClose }) => {
  const contacts = useCustomerContacts(open ? customer : undefined);
  const name = useSetBillingContact(customer);
  const add = useAddBillingContact(customer);

  const [chosen, setChosen] = useState<string | null>(current);
  const [adding, setAdding] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  const rows = contacts.data ?? [];
  const failure = (name.error ?? add.error) as Error | undefined;

  const save = async () => {
    try {
      if (adding) await add.mutateAsync({ customer, full_name: fullName, email });
      else await name.mutateAsync({ customer, contact: chosen });
      onClose();
    } catch {
      // surfaced below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Mail}
      tone="blue"
      title="Billing contact"
      subtitle={`${customer} — the one person told when an invoice is issued.`}
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={
              name.isLoading ||
              add.isLoading ||
              (adding && (!fullName.trim() || !email.includes('@')))
            }
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {!adding && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {rows.length === 0 && !contacts.isLoading && (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                This company has no contact yet. Add the accountant below.
              </p>
            )}

            {rows.map((row) => (
              <label
                key={row.name}
                className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="billing-contact"
                  checked={chosen === row.name}
                  onChange={() => setChosen(row.name)}
                  className="h-4 w-4 border-slate-300"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{row.label}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {row.email || 'no email address'}
                    {row.has_account ? ' · has an account here' : ''}
                  </span>
                </span>
              </label>
            ))}

            <label className="flex cursor-pointer items-center gap-3 border-t border-slate-100 px-4 py-3 hover:bg-slate-50">
              <input
                type="radio"
                name="billing-contact"
                checked={chosen === null}
                onChange={() => setChosen(null)}
                className="h-4 w-4 border-slate-300"
              />
              <span className="text-sm text-slate-600">
                Nobody — no invoice notice is sent for this company
              </span>
            </label>
          </div>
        )}

        {adding && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel required>Full name</FieldLabel>
              <input
                autoFocus
                value={fullName}
                aria-label="Full name"
                onChange={(event) => setFullName(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <FieldLabel required>Email</FieldLabel>
              <input
                value={email}
                aria-label="Email"
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              They need no account here: naming them does not grant any access to the portal.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setAdding((current) => !current)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-800"
        >
          <UserPlus size={14} />
          {adding ? 'Choose an existing contact instead' : 'Add somebody who has no account'}
        </button>

        {failure && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{failure.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default BillingContactModal;
