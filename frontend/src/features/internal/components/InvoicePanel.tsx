import React from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import { salesInvoiceDeskUrl } from '@/lib/api/internal';
import { useBillingInvoice } from '../hooks/useBilling';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-xs font-medium text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm text-slate-700">{value}</p>
  </div>
);

/** Everything here is what ERPNext holds, not what the run computed. */
const InvoicePanel: React.FC<{ run: string; isAdmin?: boolean }> = ({ run, isAdmin }) => {
  const view = useBillingInvoice(run);
  const data = view.data;
  const invoice = data?.invoice;

  if (view.isLoading) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (view.error instanceof Error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        {view.error.message}
      </div>
    );
  }

  if (!invoice) return null;

  const money = (value: number) =>
    `${invoice.currency} ${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Landmark size={16} className="text-slate-400" />
          <h2 className="text-base font-semibold text-slate-900">{invoice.name}</h2>
          <StatusBadge value={invoice.status} />
          {invoice.is_return && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              CREDIT NOTE
            </span>
          )}
        </div>
        {isAdmin && (
          <a
            href={salesInvoiceDeskUrl(invoice.name)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <ExternalLink size={14} />
            Open in the accounting desk
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 px-5 pb-4 sm:grid-cols-4">
        <Fact label="Customer" value={invoice.customer_name || invoice.customer} />
        <Fact label="Contract" value={data?.contract_title || data?.contract || 'N/A'} />
        <Fact label="Invoice date" value={fmtDate(invoice.posting_date)} />
        <Fact
          label="Due date"
          value={
            <>
              {fmtDate(invoice.due_date)}
              {invoice.payment_terms_template && (
                <span className="ml-1.5 text-xs text-slate-400">
                  {invoice.payment_terms_template}
                </span>
              )}
            </>
          }
        />
        <Fact label="Company" value={invoice.company} />
        <Fact label="Currency" value={invoice.currency} />
        {(data?.dimensions ?? []).map((entry) => (
          <Fact key={entry.fieldname} label={entry.label} value={entry.value || 'N/A'} />
        ))}
      </div>

      <div className="max-h-[62vh] overflow-auto px-5 pb-4">
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              {['Item', 'Billed', 'Qty', 'Rate', 'Discount', 'Amount', 'Accounting'].map(
                (column, index) => (
                  <th
                    key={column}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === 6 ? 'rounded-r-lg' : ''}`}
                  >
                    {column}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.items ?? []).map((item) => (
              <tr key={item.idx} className="align-top">
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{item.item_name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{item.item_code}</p>
                  {item.targets.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs font-medium text-blue-600">
                        {item.targets.length} covered
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {item.targets.map((target, index) => (
                          <li key={index} className="text-xs text-slate-500">
                            {target.user_name || target.hostname || '—'}
                            {target.hostname && target.user_name ? ` · ${target.hostname}` : ''}
                            {target.serial_number ? ` · ${target.serial_number}` : ''}
                            {target.covered_from
                              ? ` · ${fmtDate(target.covered_from)} → ${fmtDate(target.covered_to)}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {item.billed_count || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {item.qty} {item.uom}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {money(item.price_list_rate || item.rate)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {item.discount_percentage ? `${item.discount_percentage}%` : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
                  {money(item.amount)}
                </td>
                <td className="px-4 py-3">
                  {item.dimensions.length === 0 ? (
                    <span className="text-sm text-slate-400">—</span>
                  ) : (
                    item.dimensions.map((entry) => (
                      <p key={entry.fieldname} className="text-xs text-slate-600">
                        <span className="text-slate-400">{entry.label}:</span> {entry.value}
                      </p>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end border-t border-slate-100 px-5 py-4">
        <div className="w-full space-y-1.5 sm:max-w-xs">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-slate-700 tabular-nums">{money(invoice.net_total)}</span>
          </div>
          {(data?.taxes ?? []).map((tax, index) => (
            <div key={index} className="flex justify-between text-sm">
              <span className="text-slate-500">{tax.description}</span>
              <span className="text-slate-700 tabular-nums">{money(tax.tax_amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-100 pt-1.5 text-sm font-semibold">
            <span className="text-slate-900">Grand total</span>
            <span className="text-slate-900 tabular-nums">{money(invoice.grand_total)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Outstanding</span>
            <span
              className={`tabular-nums ${
                invoice.outstanding_amount ? 'font-semibold text-amber-700' : 'text-emerald-600'
              }`}
            >
              {money(invoice.outstanding_amount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePanel;
