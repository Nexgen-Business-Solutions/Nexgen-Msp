import React from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import { salesInvoiceDeskUrl } from '@/lib/api/internal';
import { useBillingInvoice } from '../hooks/useBilling';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0 rounded-xl bg-slate-50/70 px-3.5 py-2.5 ring-1 ring-slate-200/60">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{value}</p>
  </div>
);

/** Everything here is what ERPNext holds, not what the run computed. */
const InvoicePanel: React.FC<{ run: string; isAdmin?: boolean }> = ({ run, isAdmin }) => {
  const view = useBillingInvoice(run);
  const data = view.data;
  const invoice = data?.invoice;

  if (view.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200/70">
        <span className="size-6 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (view.error instanceof Error) {
    return (
      <div className="rounded-2xl bg-red-50 p-5 text-sm text-red-700 ring-1 ring-red-100">
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
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
          >
            <Landmark className="size-[18px]" strokeWidth={1.75} />
          </span>
          <h2 className="text-base font-semibold text-slate-900">{invoice.name}</h2>
          <StatusBadge value={invoice.status} />
          {invoice.is_return && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200/70">
              CREDIT NOTE
            </span>
          )}
        </div>
        {isAdmin && (
          <a
            href={salesInvoiceDeskUrl(invoice.name)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            <ExternalLink size={14} />
            Open in the accounting desk
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 px-5 pb-5 min-[420px]:grid-cols-2 lg:grid-cols-4">
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

      <div className="max-h-[62vh] overflow-auto">
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
            <tr>
              {['Item', 'Billed', 'Qty', 'Rate', 'Discount', 'Amount', 'Accounting'].map(
                (column, index) => (
                  <th
                    key={column}
                    className={`whitespace-nowrap border-b border-slate-200 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${
                      index >= 1 && index <= 5 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {column}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.items ?? []).map((item) => (
              <tr key={item.idx} className="align-top transition-colors hover:bg-slate-50/80">
                <td className="px-5 py-3">
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
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-slate-600 tabular-nums">
                  {item.billed_count || '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-slate-600 tabular-nums">
                  {item.qty} {item.uom}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-slate-600 tabular-nums">
                  {item.price_list_rate ? money(item.price_list_rate) : '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-slate-600 tabular-nums">
                  {item.price_list_rate ? `${item.discount_percentage || 0}%` : '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-sm font-semibold text-slate-900 tabular-nums">
                  {money(item.amount)}
                </td>
                <td className="px-5 py-3">
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

      <div className="flex justify-end border-t border-slate-100 bg-slate-50/50 px-5 py-4">
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
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
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
