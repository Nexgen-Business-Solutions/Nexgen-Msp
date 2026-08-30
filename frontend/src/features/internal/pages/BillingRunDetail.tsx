import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  Printer,
  ReceiptText,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Undo2,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import CreditNoteModal from '../components/CreditNoteModal';
import InvoiceAccountingModal from '../components/InvoiceAccountingModal';
import InvoicePanel from '../components/InvoicePanel';
import { breakdownFileUrl, invoicePdfUrl, salesInvoiceDeskUrl } from '@/lib/api/internal';
import { useBillingRun, useRunAction, useSetLineDiscount } from '../hooks/useBilling';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Stat = ({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  alert?: boolean;
}) => (
  <div>
    <p className="text-xs font-medium text-slate-400">{label}</p>
    <p
      className={`mt-0.5 text-xl font-bold tabular-nums ${
        alert ? 'text-amber-600' : 'text-slate-900'
      }`}
    >
      {value}
    </p>
    {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
  </div>
);

const COLUMNS = [
  'Service',
  'User',
  'Device',
  'Covered',
  'Months',
  'Rate',
  'Discount',
  'Amount',
  'Note',
  '',
];

export default function BillingRunDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useBillingRun(name);
  const action = useRunAction();
  const [contesting, setContesting] = useState(false);
  const [notify, setNotify] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const setDiscount = useSetLineDiscount();

  const data = detail.data;

  // what an administrator counts before approving: how many lines, on how many people and
  // machines, for how many months, and what each service weighs in the total
  const stats = useMemo(() => {
    const billed = (data?.lines ?? []).filter((line) => !line.exception_code);
    const tally = new Map<string, { name: string; count: number; months: number; amount: number }>();

    for (const line of billed) {
      const key = line.service_item;
      const row = tally.get(key) ?? {
        name: line.service_name || key,
        count: 0,
        months: 0,
        amount: 0,
      };
      row.count += 1;
      row.months += line.billable_months;
      row.amount += line.amount;
      tally.set(key, row);
    }

    return {
      billable: billed.length,
      people: new Set(billed.map((line) => line.client_user).filter(Boolean)).size,
      devices: new Set(billed.map((line) => line.hostname).filter(Boolean)).size,
      months: billed.reduce((sum, line) => sum + line.billable_months, 0),
      perService: [...tally.values()].sort((a, b) => b.amount - a.amount),
    };
  }, [data?.lines]);


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
  const run = async (verb: string, extra?: Record<string, unknown>) => {
    try {
      const result = await action.mutateAsync({ action: verb, name: name as string, extra });

      // reopening produces an amendment under a new name, so follow it
      if (result.name !== name) navigate(`/msp/billing/${result.name}`);

      return true;
    } catch {
      // shown by the error banner below
      return false;
    }
  };

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
              {data.disputed && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                  DISPUTED
                </span>
              )}
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
            {data.sales_order && (
              <p className="mt-1 text-xs text-slate-400">Order {data.sales_order}</p>
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

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Billed lines" value={stats.billable} hint={`of ${data.lines.length}`} />
          <Stat label="People" value={stats.people} hint="distinct users" />
          <Stat label="Devices" value={stats.devices} hint="distinct machines" />
          <Stat label="Services" value={stats.perService.length} hint="on this run" />
          <Stat label="Months billed" value={stats.months.toFixed(1)} hint="user-months" />
          <Stat
            label="Blocked"
            value={data.exception_count}
            hint={data.exception_count ? 'excluded from the total' : 'nothing held back'}
            alert={data.exception_count > 0}
          />
        </div>

        {stats.perService.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {stats.perService.map((row) => (
              <div
                key={row.name}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-sm font-semibold text-slate-900">
                  {row.count}
                  <span className="ml-1.5 font-medium text-slate-500">{row.name}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                  {row.months.toFixed(1)} months · {row.amount.toLocaleString()} {currency}
                </p>
              </div>
            ))}
          </div>
        )}

        {data.disputed && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold">
                The customer disputed this invoice on {fmtDate(data.disputed_on)}
              </p>
              <p className="mt-1">{data.dispute_reason}</p>
              {data.dispute_request && (
                <button
                  type="button"
                  onClick={() => navigate(`/msp/requests/${data.dispute_request}`)}
                  className="mt-1.5 text-xs font-semibold underline underline-offset-2"
                >
                  Open request {data.dispute_request}
                </button>
              )}
            </div>
          </div>
        )}

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
          {(data.can_approve || data.can_invoice) && (
            <button
              type="button"
              onClick={() => setInvoicing(true)}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              <ShieldCheck size={15} />
              {data.can_approve ? 'Approve and invoice' : 'Create invoice'}
            </button>
          )}

          {data.can_submit_invoice && (
            <button
              type="button"
              onClick={() => run('submit_invoice', { notify: notify ? 1 : 0 })}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <FileCheck2 size={15} />
              {data.is_credit_note ? 'Submit credit note' : 'Submit invoice'}
            </button>
          )}
          {data.can_submit_invoice && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Email the customer
            </label>
          )}
          {data.can_discard_invoice && (
            <a
              href={salesInvoiceDeskUrl(data.sales_invoice as string)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <PencilLine size={15} />
              Edit invoice
            </a>
          )}
          {data.can_reopen && (
            <button
              type="button"
              onClick={() => run('reopen')}
              disabled={action.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <RotateCcw size={15} />
              Reopen run
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
          {data.can_resolve_dispute && (
            <button
              type="button"
              onClick={() => setResolving(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
            >
              <ShieldCheck size={15} />
              Settle the dispute
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

      {data.sales_invoice && <InvoicePanel run={data.name} isAdmin />}

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Lines</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Blocked lines first. Each line keeps the formula used to compute it.
          </p>
        </div>

        <div className="max-h-[62vh] overflow-auto px-5 pb-4">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
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
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {line.covered_from ? (
                      <>
                        {line.covered_from.slice(0, 10)}
                        <span className="text-slate-300"> → </span>
                        {line.covered_to?.slice(0, 10)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                    {line.exception_code || line.unit_rate === null
                      ? '—'
                      : line.unit_rate.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {data.can_discount_lines ? (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        defaultValue={line.discount_percent || ''}
                        onBlur={(event) => {
                          const next = Number(event.target.value || 0);
                          if (next !== line.discount_percent) {
                            setDiscount.mutate({
                              name: data.name,
                              service_assignment: line.service_assignment,
                              discount_percent: next,
                            });
                          }
                        }}
                        placeholder="0"
                        className="h-8 w-16 rounded-md border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-blue-500"
                      />
                    ) : (
                      <span className="text-sm text-slate-600 tabular-nums">
                        {line.discount_percent ? `${line.discount_percent}%` : '—'}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
                    {line.amount.toLocaleString()}
                    {line.discount_percent > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400 line-through">
                        {line.gross_amount.toLocaleString()}
                      </span>
                    )}
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

      <Modal
        open={resolving}
        onClose={() => setResolving(false)}
        icon={ShieldCheck}
        tone="amber"
        title="Settle this dispute"
        subtitle="Tell the customer what came of their dispute. The invoice itself is untouched."
        widthClass="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setResolving(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={action.isLoading}
              onClick={async () => {
                await run('resolve_dispute', { note: outcome || undefined });
                setResolving(false);
                setOutcome('');
              }}
              className="flex min-w-[8rem] items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {action.isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                'Settle'
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold">What they told us</p>
            <p className="mt-1">{data.dispute_reason}</p>
          </div>

          <div>
            <FieldLabel>Outcome</FieldLabel>
            <textarea
              rows={4}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="A credit note has been issued for the two people who left in May."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <p className="text-sm text-slate-500">
            If money is owed back, raise a credit note — settling the dispute does not move
            any figures on its own.
          </p>
        </div>
      </Modal>

      <InvoiceAccountingModal
        open={invoicing}
        run={data}
        loading={action.isLoading}
        error={action.error as Error | undefined}
        onClose={() => setInvoicing(false)}
        onConfirm={async (dimensions) => {
          // a refusal keeps the dialog up with the values typed, so nothing is retyped
          const step = data.can_approve ? 'finalise' : 'invoice';
          if (await run(step, { dimensions: JSON.stringify(dimensions) })) {
            setInvoicing(false);
          }
        }}
      />

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
