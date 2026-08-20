import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  Printer,
  Receipt,
  ReceiptText,
  RefreshCw,
  Undo2,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import CreditNoteModal from '../components/CreditNoteModal';
import { breakdownFileUrl, invoicePdfUrl } from '@/lib/api/internal';
import { useBillingRun, useRunAction } from '../hooks/useBilling';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const COLUMNS = ['Service', 'User', 'Device', 'Months', 'Days', 'Rate', 'Amount', 'Note', ''];

export default function BillingRunDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useBillingRun(name);
  const action = useRunAction();
  const [contesting, setContesting] = useState(false);

  const data = detail.data;

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'Billing run not found.'}
        </div>
      </div>
    );
  }

  const currency = data.currency ?? '';
  const run = (verb: string) => action.mutate({ action: verb, name });

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/billing')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to billing runs
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">{data.name}</h1>
              <StatusBadge value={data.status} />
              {data.credit_note_of && (
                <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  CREDIT NOTE OF {data.credit_note_of}
                </span>
              )}
              {data.adjustment_of && (
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  ADJUSTMENT OF {data.adjustment_of}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {data.customer} · {data.period_label} · {fmtDate(data.billing_period_start)} →{' '}
              {fmtDate(data.billing_period_end)}
            </p>
            {data.contract_title && (
              <p className="mt-1 text-xs text-slate-400">Contract: {data.contract_title}</p>
            )}
            {data.approved_by && (
              <p className="mt-1 text-xs text-slate-400">
                Approved by {data.approved_by} on {fmtDate(data.approved_at)}
              </p>
            )}
            {data.sales_invoice && (
              <p className="mt-1 text-sm font-medium text-emerald-600">
                Invoiced as {data.sales_invoice}
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  ({data.invoice_submitted ? 'posted' : 'draft — not posted yet'})
                </span>
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-xs font-medium text-slate-400">Total</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {(data.total_amount || 0).toLocaleString()} {currency}
            </p>
            <p className="text-xs text-slate-400">
              {data.lines.length - data.exception_count} of {data.lines.length} lines billable
            </p>
          </div>
        </div>

        {data.exception_count > 0 && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{data.exception_count} line(s) blocked.</span> Fix the
              underlying data, then revalidate — this run cannot be approved until they clear.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {data.can_revalidate && (
            <button
              type="button"
              onClick={() => run('revalidate')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={15} />
              Revalidate
            </button>
          )}
          {data.can_approve && (
            <button
              type="button"
              onClick={() => run('approve')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              <ShieldCheck size={15} />
              Approve and freeze
            </button>
          )}
          {data.can_invoice && (
            <button
              type="button"
              onClick={() => run('invoice')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <Receipt size={15} />
              Create invoice
            </button>
          )}
          {data.can_submit_invoice && (
            <button
              type="button"
              onClick={() => run('submit_invoice')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <FileCheck2 size={15} />
              Post the invoice
            </button>
          )}
          {data.can_discard_invoice && (
            <button
              type="button"
              onClick={() => run('discard_invoice')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <Undo2 size={15} />
              Discard invoice
            </button>
          )}
          {data.invoice_submitted && (
            <a
              href={invoicePdfUrl(data.name)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Printer size={15} />
              Invoice PDF
            </a>
          )}
          <a
            href={breakdownFileUrl(data.name)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileSpreadsheet size={15} />
            Breakdown file
          </a>
          {data.can_issue_credit_note && (
            <button
              type="button"
              onClick={() => run('issue_credit_note')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <ReceiptText size={15} />
              Issue credit note
            </button>
          )}
          {data.can_contest && (
            <button
              type="button"
              onClick={() => setContesting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <ReceiptText size={15} />
              Contest invoice
            </button>
          )}
          {data.can_cancel && (
            <button
              type="button"
              onClick={() => run('cancel')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              <X size={15} />
              Cancel run
            </button>
          )}
        </div>

        {action.error instanceof Error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{action.error.message}</span>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Lines</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Blocked lines first. Each line keeps the formula used to compute it.
          </p>
        </div>

        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.lines.map((line) => (
                <tr
                  key={`${line.service_assignment}-${line.idx}`}
                  className={`transition-colors hover:bg-slate-50 ${
                    line.exception_code ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {line.service_name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                    {line.user_name || 'N/A'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {line.hostname || 'N/A'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-700 tabular-nums">
                    {line.billable_months}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500 tabular-nums">
                    {line.billable_days}/{line.period_days}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                    {line.exception_code || line.unit_rate === null
                      ? '—'
                      : line.unit_rate.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
                    {line.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {line.exception_code ? (
                      <div>
                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          {line.exception_code}
                        </span>
                        {line.exception_detail && (
                          <p className="mt-1 max-w-xs text-xs text-amber-700">
                            {line.exception_detail}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">{line.proration_method}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'View profile',
                            icon: Eye,
                            onClick: () => navigate(`/msp/users/${line.client_user}`),
                            disabled: !line.client_user,
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CreditNoteModal
        open={contesting}
        run={data.name}
        onClose={() => setContesting(false)}
        onCreated={(created) => {
          setContesting(false);
          navigate(`/msp/billing/${created}`);
        }}
      />
    </div>
  );
}
