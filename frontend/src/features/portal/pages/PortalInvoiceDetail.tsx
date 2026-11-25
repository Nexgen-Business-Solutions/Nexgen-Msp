import React, { useState } from 'react';
import BusinessText from '@/shared/components/BusinessText';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  FileSpreadsheet,
  Printer,
  Receipt,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
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

const Th = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => (
  <th
    className={`whitespace-nowrap border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${
      right ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

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
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (detail.error instanceof Error || !data || !run) {
    return (
      <div className="px-6 pb-6 pt-5">
        <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-100">
          {(detail.error as Error)?.message ?? 'This invoice is not available.'}
        </div>
      </div>
    );
  }

  const currency = run.currency ?? '';

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <button
        type="button"
        onClick={() => navigate('/msp/invoices')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to invoices
      </button>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <Receipt className="size-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900">
                  {run.sales_invoice ?? run.name}
                </h1>
                <StatusBadge value={data.invoice?.docstatus === 1 ? 'Posted' : 'Draft'} />
                {Boolean(run.disputed) && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                    DISPUTED
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm text-slate-500">
                {periodLabel(run.billing_period_start, run.billing_period_end)} ·{' '}
                {fmtDate(run.billing_period_start)} → {fmtDate(run.billing_period_end)}
              </p>
              {data.invoice && (
                <p className="mt-1 text-xs text-slate-400">
                  Issued on {fmtDate(data.invoice.posting_date)}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0 rounded-xl bg-slate-50/70 px-4 py-3 ring-1 ring-slate-200/60 lg:bg-transparent lg:p-0 lg:text-right lg:ring-0">
            <p className="text-[13px] text-slate-500">
              {run.is_credit_note ? 'Credited back' : 'Total'}
            </p>
            <p className="text-2xl font-bold leading-tight text-slate-900 tabular-nums">
              {(run.signed_amount || 0).toLocaleString()} {currency}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">{data.line_count} lines billed</p>
          </div>
        </div>

        {Boolean(run.dispute_reason) && (
          <div
            className={`mt-5 flex items-start gap-3 rounded-2xl p-4 ring-1 ${
              data.dispute_outcome?.settled
                ? 'bg-emerald-50 ring-emerald-200'
                : 'bg-amber-50 ring-amber-200'
            }`}
          >
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl bg-white ring-1 ${
                data.dispute_outcome?.settled
                  ? 'text-emerald-600 ring-emerald-200'
                  : 'text-amber-600 ring-amber-200'
              }`}
            >
              {data.dispute_outcome?.settled ? (
                <ShieldCheck className="size-5" strokeWidth={1.75} />
              ) : (
                <ShieldAlert className="size-5" strokeWidth={1.75} />
              )}
            </span>
            <div
              className={`text-sm ${
                data.dispute_outcome?.settled ? 'text-emerald-900' : 'text-amber-800'
              }`}
            >
              <p className="font-semibold">
                You disputed this invoice on {fmtDate(run.disputed_on)}
              </p>
              <p className="mt-1">{run.dispute_reason}</p>
              {data.dispute_outcome?.settled ? (
                <>
                  <p className="mt-2 font-semibold">Settled</p>
                  {data.dispute_outcome.note && (
                    <p className="mt-0.5">{data.dispute_outcome.note}</p>
                  )}
                  <p className="mt-1 text-xs">
                    The invoice itself is unchanged. Anything owed back travels as a credit note.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs">
                  Our team is reviewing it and will come back to you.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={() => downloadInvoice(run.name)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            <Printer size={15} />
            Invoice PDF
          </button>
          <button
            type="button"
            onClick={() => downloadBreakdown(run.name)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            <FileSpreadsheet size={15} />
            Breakdown file
          </button>
          {data.can_dispute && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-50"
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
      </section>

      {data.services.map((service) => (
        <div
          key={service.service_name}
          className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                <BusinessText>{service.service_name}</BusinessText>
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-slate-200">
                {service.lines.length}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              {service.quantity} billed · {service.months} months ·{' '}
              <span className="font-semibold text-slate-800">
                {service.amount.toLocaleString()} {currency}
              </span>
            </p>
          </div>

          <div className="max-h-[62vh] overflow-auto px-5 pb-4 sm:px-6">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
                <tr>
                  {['User', 'Department', 'Device', 'From', 'To', 'Months', 'Amount'].map(
                    (column, index) => (
                      <Th key={column} right={index >= 5}>
                        {column}
                      </Th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {service.lines.map((line, index) => (
                  <tr
                    key={`${line.user_name}-${line.hostname}-${index}`}
                    className="transition-colors hover:bg-slate-50/80"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">
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
                      {line.stopped_on ? (
                        fmtDate(line.stopped_on)
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                          Active
                        </span>
                      )}
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
              className="rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
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
              className="flex min-w-[8rem] items-center justify-center rounded-full bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="w-full rounded-xl border-0 bg-slate-100/80 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <p className="text-sm text-slate-500">
            The invoice stays as it is while we review. If the dispute is upheld, a credit note
            is issued.
          </p>

          {dispute.error instanceof Error && (
            <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-100">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <span className="text-sm font-medium text-red-700">{dispute.error.message}</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
