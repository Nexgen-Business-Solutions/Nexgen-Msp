import React, { useState } from 'react';
import { Mail, TriangleAlert } from 'lucide-react';
import BillingContactModal from './BillingContactModal';
import { useCustomerDetails } from '../hooks/useCustomerDetails';

/**
 * Who this company's invoices are announced to.
 *
 * Nobody is named to begin with, and nothing is sent until somebody is: there is no
 * fallback, because the fallback is what sent billing information to every portal account.
 */
const BillingContactPanel: React.FC<{ customer: string }> = ({ customer }) => {
  const details = useCustomerDetails(customer);
  const [open, setOpen] = useState(false);

  const billing = details.data?.billing_contact;
  const mayEdit = details.data?.can.edit_commercial ?? false;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Billing contact</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            The one person told when an invoice is issued. Nobody else receives it.
          </p>
        </div>
        {mayEdit && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <Mail size={14} />
            {billing?.contact ? 'Change' : 'Name somebody'}
          </button>
        )}
      </div>

      <div className="px-5 pb-5 sm:px-6">
        {billing?.email ? (
          <div className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <Mail className="size-[18px]" strokeWidth={1.75} />
            </span>
            <p className="min-w-0 text-sm text-slate-800">
              <span className="block truncate font-medium">{billing.full_name || billing.contact}</span>
              <span className="block truncate text-slate-500">{billing.email}</span>
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-amber-600 ring-1 ring-amber-200">
              <TriangleAlert size={16} strokeWidth={1.75} />
            </span>
            <p className="self-center text-sm text-amber-900">
              {billing?.refusal ?? 'No billing contact: no invoice notice is sent.'}
            </p>
          </div>
        )}
      </div>

      <BillingContactModal
        open={open}
        customer={customer}
        current={billing?.contact ?? null}
        onClose={() => setOpen(false)}
      />
    </section>
  );
};

export default BillingContactPanel;
