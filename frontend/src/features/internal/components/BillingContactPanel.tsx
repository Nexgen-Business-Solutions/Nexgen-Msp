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
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Billing contact</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            The one person told when an invoice is issued. Nobody else receives it.
          </p>
        </div>
        {mayEdit && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Mail size={13} />
            {billing?.contact ? 'Change' : 'Name somebody'}
          </button>
        )}
      </div>

      <div className="px-5 pb-5">
        {billing?.email ? (
          <p className="text-sm text-slate-800">
            <span className="font-medium">{billing.full_name || billing.contact}</span>
            <span className="ml-2 text-slate-500">{billing.email}</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            {billing?.refusal ?? 'No billing contact: no invoice notice is sent.'}
          </p>
        )}
      </div>

      <BillingContactModal
        open={open}
        customer={customer}
        current={billing?.contact ?? null}
        onClose={() => setOpen(false)}
      />
    </div>
  );
};

export default BillingContactPanel;
