import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Clock, FileSpreadsheet, Printer, ShieldAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import StatusBadge from '@/shared/components/StatusBadge';
import { downloadInvoice, downloadBreakdown } from '@/lib/api/portal';
import { useDisputeInvoice, usePortalBillingDetail } from '../hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const periodLabel = (start: string, end: string) => {
  const from = new Date(start);
  const to = new Date(end);

  if (from.getFullYear() === to.getFullYear() && to.getMonth() - from.getMonth() === 2) {
    return `Q${Math.floor(from.getMonth() / 3) + 1} ${from.getFullYear()}`;
  }

  return `${fmtDate(start)} → ${fmtDate(end)}`;
};

export default function PortalInvoiceDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const detail = usePortalBillingDetail(name);
  const dispute = useDisputeInvoice();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const data = detail.data;
  const run = data?.run;

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error instanceof Error || !data || !run) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message ?? 'This invoice is not available.'}
        </div>
      </div>
    );
  }

  const currency = run.currency ?? '';

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/invoices')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to invoices
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">
                {run.sales_invoice ?? run.name}
              </h1>
              <StatusBadge value={data.invoice?.docstatus === 1 ? 'Posted' : 'Draft'} />
              {Boolean(run.disputed) && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                  DISPUTED
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {periodLabel(run.billing_period_start, run.billing_period_end)} ·{' '}
              {fmtDate(run.billing_period_start)} → {fmtDate(run.billing_period_end)}
            </p>
            {data.invoice && (
              <p className="mt-1 text-xs text-slate-400">
                Issued on {fmtDate(data.invoice.posting_date)}
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-xs font-medium text-slate-400">Total</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {(run.total_amount || 0).toLocaleString()} {currency}
            </p>
            <p className="text-xs text-slate-400">{data.line_count} lines billed</p>
          </div>
        </div>

        {Boolean(run.disputed) && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold">
                You disputed this invoice on {fmtDate(run.disputed_on)}
              </p>
              <p className="mt-1">{run.dispute_reason}</p>
              <p className="mt-1 text-xs">Our team is reviewing it and will come back to you.</p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadInvoice(run.name)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Printer size={15} />
            Invoice PDF
          </button>
          <button
            type="button"
            onClick={() => downloadBreakdown(run.name)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileSpreadsheet size={15} />
            Breakdown file
          </button>
          {data.can_dispute && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50"
            >
              <ShieldAlert size={15} />
              Dispute this invoice
            </button>
          )}
          {!run.disputed && !data.dispute_window.open && (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Clock size={15} className="text-slate-400" />
              Could be disputed until {fmtDate(data.dispute_window.closes_on)}
            </span>
          )}
        </div>
      </div>

      {data.services.map((service) => (
        <div
          key={service.service_name}
          className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">{service.service_name}</h2>
            <p className="text-sm text-slate-500">
              {service.quantity} billed · {service.months} months ·{' '}
              <span className="font-semibold text-slate-800">
                {service.amount.toLocaleString()} {currency}
              </span>
            </p>
          </div>

          <div className="max-h-[62vh] overflow-auto px-5 pb-4">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  {['User', 'Department', 'Device', 'From', 'To', 'Months', 'Amount'].map(
                    (column, index) => (
                      <th
                        key={column}
                        className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                          index >= 5 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {column}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {service.lines.map((line, index) => (
                  <tr key={`${line.user_name}-${line.hostname}-${index}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-800">
                      {line.user_name || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {line.department || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {line.hostname || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                      {fmtDate(line.started_on)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                      {line.stopped_on ? fmtDate(line.stopped_on) : 'Active'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-slate-700 tabular-nums">
                      {line.billable_months}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-slate-900 tabular-nums">
                      {line.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon={ShieldAlert}
        tone="amber"
        title="Dispute this invoice"
        subtitle="Tell us what is wrong and our team will review it."
        widthClass="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reason.trim() || dispute.isLoading}
              onClick={async () => {
                try {
                  await dispute.mutateAsync({ name: run.name, reason });
                  setOpen(false);
                  setReason('');
                } catch {
                  // surfaced below
                }
              }}
              className="flex min-w-[8rem] items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {dispute.isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                'Send the dispute'
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <FieldLabel required>What is wrong?</FieldLabel>
            <textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Two people left in May and are still being billed…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <p className="text-sm text-slate-500">
            The invoice stays as it is while we review. If the dispute is upheld, a credit note
            is issued.
          </p>

          {dispute.error instanceof Error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <span className="text-sm font-medium text-red-700">{dispute.error.message}</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
