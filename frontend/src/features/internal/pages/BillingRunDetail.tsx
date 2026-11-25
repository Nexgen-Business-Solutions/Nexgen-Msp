import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Building2,
  CalendarDays,
  Download,
  FileText,
  Layers,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import Modal from '@/shared/components/Modal';
import BillingExceptionGroup from '../components/BillingExceptionGroup';
import InvoiceAccountingModal from '../components/InvoiceAccountingModal';
import InvoicePanel from '../components/InvoicePanel';
import NotifyRecipientsModal from '../components/NotifyRecipientsModal';
import { subjectOf } from '../lib/billingSubject';
import { downloadBreakdownFile, downloadInvoicePdf, salesInvoiceDeskUrl } from '@/lib/api/internal';
import type { BillingRunLine } from '@/lib/api/internal';
import {
  useBillingRunView,
  useRemoveFromBillingRun,
  useRunAction,
  useSetLineDiscount,
} from '../hooks/useBilling';
import {
  Banner,
  Card,
  CardHead,
  ContextBar,
  Divider,
  Empty,
  Foot,
  InfoPanel,
  Metric,
  PanelTitle,
  Pill,
  Stepper,
  Summary,
  Td,
  Th,
  btn,
  btnDanger,
  btnPrimary,
  btnWarn,
  rowClass,
} from '../components/billing/ui';
import { day, money } from '../components/billing/format';

const COLUMNS = ['Service / assignment', 'User / device', 'Coverage', 'Months', 'Rate', 'Discount', 'Amount', 'Note', ''];

const KIND_TONE: Record<string, 'blue' | 'amber' | 'purple' | 'gray'> = {
  'Regular billing': 'blue',
  Additions: 'amber',
  'Credit note': 'purple',
  'Historical coverage': 'gray',
};

const statusTone = (status: string) =>
  status === 'Invoiced'
    ? ('green' as const)
    : // a run somebody stopped: said in the one colour nobody reads as progress
      status === 'Cancelled'
      ? ('red' as const)
      : status === 'Exception' || status === 'Ready for Approval'
        ? ('amber' as const)
        : ('blue' as const);

/**
 * One billing run, read as the record of a decision rather than as a form.
 *
 * The head says what it is and what it still allows; the four figures say what it holds;
 * the lines say how each amount was reached. A run nobody can move any further carries no
 * progress bar at all — it is history by then.
 */
export default function BillingRunDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const view = useBillingRunView(name);
  const action = useRunAction();
  const drop = useRemoveFromBillingRun();
  const setDiscount = useSetLineDiscount();
  const [settling, setSettling] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [invoicing, setInvoicing] = useState(false);
  const [telling, setTelling] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [reason, setReason] = useState('');
  const [reconciling, setReconciling] = useState(false);

  const data = view.data;

  const move = async (what: string, extra?: Record<string, unknown>) => {
    try {
      const result = await action.mutateAsync({ action: what, name, extra });
      // reopening produces an amendment under a new name, so follow it
      if (result.name !== name) navigate(`/msp/billing/${result.name}`);

      return true;
    } catch {
      return false;
    }
  };

  if (view.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (view.error || !data) {
    return (
      <div className="px-6 pb-6 pt-5">
        <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-5 text-sm text-red-700 ring-1 ring-red-100">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70 text-red-600 ring-1 ring-red-100">
            <AlertCircle className="size-[18px]" strokeWidth={1.75} />
          </span>
          <span className="self-center">{(view.error as Error)?.message || 'Billing run not found.'}</span>
        </div>
      </div>
    );
  }

  const currency = data.currency ?? '';
  const blocked = data.lines.filter((line) => line.exception_code);

  /** Crediting this charge: the proposal as detected, or its lines for somebody to cut. */
  const creditPath = (scope: 'detected' | 'all') =>
    `/msp/billing/new?kind=credit_note&contract=${encodeURIComponent(data.contract ?? '')}` +
    `&start=${data.billing_period_start}&end=${data.billing_period_end}` +
    `&against=${data.name}&scope=${scope}`;

  // every move the run allows, drawn where the decision is taken
  const run = (what: string) => {
    if (what === 'invoice') return setInvoicing(true);
    if (what === 'submit_invoice') return setTelling(true);
    if (what === 'resolve_dispute') return setSettling(true);
    if (what === 'cancel') return setUndoing(true);
    if (what === 'reconcile') return setReconciling(true);
    if (what === 'invoice_pdf') return downloadInvoicePdf(data.name);
    if (what === 'breakdown') return downloadBreakdownFile(data.name);
    if (what === 'edit_invoice')
      return window.open(salesInvoiceDeskUrl(data.sales_invoice as string), '_blank');
    // a credit stands against this very run, never against whatever was charged last
    if (what === 'credit') return navigate(creditPath('all'));

    return void move(what);
  };

  const look = (style: string) =>
    style === 'primary' ? btnPrimary : style === 'warn' ? btnWarn : btn;

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <button
        type="button"
        onClick={() => navigate('/msp/billing')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeft size={14} />
        Back to billing
      </button>

      <Card>
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden
              className={`grid size-14 shrink-0 place-items-center rounded-2xl ring-1 ${
                data.is_credit_note
                  ? 'bg-violet-50 text-violet-600 ring-violet-100'
                  : data.status === 'Cancelled'
                    ? 'bg-slate-100 text-slate-500 ring-slate-200'
                    : 'bg-blue-50 text-blue-600 ring-blue-100'
              }`}
            >
              <FileText className="size-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900">
                  {data.name}
                </h1>
                <Pill tone={KIND_TONE[data.kind] ?? 'gray'}>{data.kind}</Pill>
                <Pill tone={statusTone(data.status)}>{data.status}</Pill>
                {data.disputed && <Pill tone="red">Disputed</Pill>}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-slate-600">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Building2 size={14} className="shrink-0 text-slate-400" strokeWidth={1.75} />
                  <span className="truncate">{data.customer}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <CalendarDays size={14} className="shrink-0 text-slate-400" strokeWidth={1.75} />
                  {day(data.billing_period_start)} – {day(data.billing_period_end)}
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            {data.moves.map((entry) => (
              <button
                key={entry.action}
                type="button"
                onClick={() => run(entry.action)}
                disabled={action.isLoading}
                className={look(entry.look)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <ContextBar
          facts={[
            { label: 'Customer', value: data.customer },
            { label: 'Contract', value: data.contract_title || data.contract || '—' },
            {
              label: 'Terms',
              value: [data.billing_frequency, data.billing_timing].filter(Boolean).join(' / ') || '—',
            },
            { label: 'Proration', value: data.proration_method || '—' },
            { label: 'Prepared by', value: data.prepared_by || '—' },
          ]}
        />

        {!data.settled && <Stepper steps={data.stages} current={data.stage} />}
      </Card>

      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-6 xl:grid-cols-4">
        <Metric
          icon={Wallet}
          tone={data.is_credit_note ? 'purple' : 'blue'}
          label="Amount"
          value={money(data.figures.amount, currency)}
          hint={data.is_credit_note ? 'credited back' : 'before taxes'}
        />
        <Metric
          icon={Layers}
          tone="gray"
          label="Billing lines"
          value={data.figures.billed_lines}
          hint={`of ${data.figures.lines} · ${data.figures.months.toFixed(1)} months`}
        />
        <Metric
          icon={TriangleAlert}
          tone="gray"
          raised={data.figures.exceptions > 0}
          label="Exceptions"
          value={data.figures.exceptions}
          hint={data.figures.exceptions ? 'to resolve before posting' : 'nothing held back'}
        />
        <Metric
          icon={Receipt}
          tone={data.sales_invoice ? 'green' : 'gray'}
          label="Sales invoice"
          value={data.sales_invoice ?? 'Not created'}
          hint={
            data.sales_invoice
              ? data.accounting_state === 'Posted'
                ? 'posted in ERPNext'
                : data.accounting_state === 'Cancelled'
                  ? 'cancelled in ERPNext'
                  : 'draft — not posted yet'
              : undefined
          }
        />
      </div>

      {data.disputed && (
        <Banner title="Invoice disputed.">
          {data.dispute_reason} Settling a dispute does not alter the invoice; a credit note, if
          justified, is a separate operation.
          {data.dispute_request && (
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/${data.dispute_request}`)}
              className="ml-1 font-semibold underline underline-offset-2 hover:no-underline"
            >
              Open request {data.dispute_request}
            </button>
          )}
        </Banner>
      )}

      {/* what this charge owes back on its own reading, offered the way Ready to bill
          offers it: a proposal somebody opens, never a document raised on its own */}
      {data.credit_detected && (
        <Banner tone="amber" title="A credit note is detected on this run.">
          {data.credit_detected.lines} line
          {data.credit_detected.lines > 1 ? 's' : ''} ·{' '}
          {money(data.credit_detected.amount, data.credit_detected.currency)} paid for and not
          served.
          <button
            type="button"
            onClick={() => navigate(creditPath('detected'))}
            className="ml-1 font-semibold underline underline-offset-2 hover:no-underline"
          >
            Review credit →
          </button>
        </Banner>
      )}

      {data.accounting_mismatch && (
        <Banner tone="amber" title="This run and ERPNext do not agree.">
          {data.accounting_mismatch.message}
          {data.can_reconcile && (
            <button
              type="button"
              onClick={() => setReconciling(true)}
              className="ml-1 font-semibold underline underline-offset-2 hover:no-underline"
            >
              Reconcile →
            </button>
          )}
        </Banner>
      )}

      {data.cancellation && (
        <Banner tone="blue" title="This run was cancelled.">
          {data.cancellation.reason || 'No reason was given.'} Cancelled by{' '}
          {data.cancellation.by || 'somebody'}
          {data.cancellation.before.document
            ? ` · ${data.cancellation.before.document} was cancelled in ERPNext with it.`
            : '.'}
        </Banner>
      )}

      {data.invoice_amended_to && (
        <Banner tone="blue" title="The document was amended in ERPNext.">
          {data.sales_invoice} was replaced by {data.invoice_amended_to}. This run keeps the
          document it drew; moving it onto the replacement is a decision nobody has taken here.
        </Banner>
      )}

      {data.reconstructed && (
        <Banner tone="blue" title="Historical coverage recorded.">
          {data.coverage_evidence ||
            'This run records a charge raised before this application. No invoice was ever drawn from it here.'}
        </Banner>
      )}

      <BillingExceptionGroup
        run={data.name}
        lines={data.lines}
        canEdit={Boolean(data.can_revalidate)}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHead
            title="Billing lines"
            hint="Quantities, coverage periods and service changes, as they were drawn."
            count={data.lines.length}
            right={
              <button type="button" onClick={() => downloadBreakdownFile(data.name)} className={btn}>
                <Download size={14} />
                Breakdown file
              </button>
            }
          />
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {COLUMNS.map((column, index) => (
                    <Th key={column || index} align={index >= 3 && index <= 6 ? 'right' : 'left'}>
                      {column}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.lines.length === 0 && <Empty span={COLUMNS.length} icon={Layers}>
                    Nothing on this run.
                  </Empty>}
                {[...data.lines]
                  .sort((left, right) => Number(Boolean(right.exception_code)) - Number(Boolean(left.exception_code)))
                  .map((line) => (
                    <LineRow
                      key={line.service_assignment}
                      line={line}
                      currency={currency}
                      customer={data.customer}
                      canDiscount={Boolean(data.can_discount_lines)}
                      canRemove={Boolean(data.can_revalidate)}
                      onDiscount={(percent) =>
                        setDiscount.mutate({
                          name: data.name,
                          service_assignment: line.service_assignment,
                          discount_percent: percent,
                        })
                      }
                      onRemove={() =>
                        drop.mutate({ name: data.name, service_assignment: line.service_assignment })
                      }
                    />
                  ))}
              </tbody>
            </table>
          </div>
          <Foot
            left={`${data.figures.billed_lines} billed · ${blocked.length} held back`}
            right={
              <strong className="text-base font-semibold tabular-nums text-slate-900">
                {money(data.figures.amount, currency)}
              </strong>
            }
          />
        </Card>

        <div className="space-y-6">
          <InfoPanel>
            <PanelTitle>Run details</PanelTitle>
            <Summary
              rows={[
                { label: 'Billing timing', value: data.billing_timing || '—' },
                { label: 'Frequency', value: data.billing_frequency || '—' },
                { label: 'Proration', value: data.proration_method || '—' },
                { label: 'People', value: data.figures.people },
                { label: 'Devices', value: data.figures.devices },
                { label: 'Prepared by', value: data.prepared_by || '—' },
                {
                  label: 'Approved by',
                  value: data.approved_by ? `${data.approved_by} · ${day(data.approved_at)}` : '—',
                },
              ]}
            />

            <Divider />
            <PanelTitle>Documents</PanelTitle>
            <Summary
              rows={[
                {
                  label: 'Sales invoice',
                  value: data.sales_invoice ? (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/msp/billing/invoices/${encodeURIComponent(data.sales_invoice as string)}`)
                      }
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {data.sales_invoice}
                    </button>
                  ) : (
                    'Not created'
                  ),
                },
                { label: 'Sales order', value: data.sales_order || '—' },
                { label: 'Billed to', value: data.billing_identity?.customer_name_snapshot || data.customer },
              ]}
            />

            {data.reconciliation && (
              <>
                <Divider />
                <PanelTitle>
                  What was billed, and what the document says
                </PanelTitle>
                <Summary
                  rows={[
                    {
                      label: 'Run amount',
                      value: money(
                        data.reconciliation.run_amount,
                        data.reconciliation.run_currency ?? data.reconciliation.currency
                      ),
                    },
                    {
                      label: 'Document net total',
                      value: money(data.reconciliation.net_total, data.reconciliation.currency),
                    },
                    {
                      label: 'Taxes',
                      value: money(data.reconciliation.taxes, data.reconciliation.currency),
                    },
                    {
                      label: 'Document total',
                      value: money(data.reconciliation.grand_total, data.reconciliation.currency),
                    },
                    {
                      label: 'Difference',
                      value: (
                        <span
                          className={
                            data.reconciliation.material ? 'text-amber-700' : 'text-slate-700'
                          }
                        >
                          {data.reconciliation.difference === null
                            ? 'Not comparable'
                            : money(data.reconciliation.difference, data.reconciliation.currency)}
                        </span>
                      ),
                    },
                  ]}
                />
                {data.reconciliation.currency_mismatch && (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                    This run was drawn in {data.reconciliation.currency_mismatch.run ?? '—'} and
                    its document is in {data.reconciliation.currency_mismatch.invoice ?? '—'}.
                    The two totals are not in the same money and cannot be compared.
                  </p>
                )}

                {data.reconciliation.item_differences.length > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                    <p className="text-xs font-semibold text-amber-900">
                      The document no longer bills what the run was drawn on
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {data.reconciliation.item_differences.map((row) => (
                        <li key={row.service_item} className="text-xs text-amber-900">
                          <span className="font-medium">{row.item_name}</span>
                          {' — '}
                          {row.state === 'missing'
                            ? 'on the run, not on the document'
                            : row.state === 'added'
                              ? 'on the document, not on the run'
                              : [
                                  row.run_qty !== row.invoice_qty ||
                                  row.run_amount !== row.invoice_amount
                                    ? `run says ${row.run_qty} for ${money(row.run_amount, data.reconciliation?.run_currency ?? data.reconciliation?.currency)}, document says ${row.invoice_qty} for ${money(row.invoice_amount, data.reconciliation?.currency)}`
                                    : null,
                                  row.period_moved
                                    ? 'the line no longer names the period the run covers'
                                    : null,
                                  row.unit_changed
                                    ? 'the line is no longer counted in months'
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-3 text-xs text-slate-500">
                  {data.reconciliation.basis}
                  {data.reconciliation.material
                    ? ' The document was edited after the run was drawn; the run keeps its own figures.'
                    : ''}
                </p>
              </>
            )}

            <Divider />
            <PanelTitle>Activity</PanelTitle>
            <ul className="space-y-3">
              {data.activity.map((event, index) => (
                <li
                  key={`${event.label}-${index}`}
                  className="relative flex gap-3 text-sm text-slate-700"
                >
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500 ring-4 ring-blue-50" />
                  <span>
                    {event.label}
                    {event.by && <span className="text-slate-400"> · {event.by}</span>}
                    {event.on && <span className="text-slate-400"> · {day(event.on)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </InfoPanel>
        </div>
      </div>

      {data.sales_invoice && <InvoicePanel run={data.name} isAdmin />}

      {action.error instanceof Error && (
        <div className="flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3.5 ring-1 ring-red-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" strokeWidth={1.75} />
          <span className="text-sm font-medium text-red-700">{action.error.message}</span>
        </div>
      )}

      <Modal
        open={settling}
        onClose={() => setSettling(false)}
        icon={ShieldCheck}
        tone="amber"
        title="Settle this dispute"
        subtitle="Tell the customer what came of their dispute. The invoice itself is untouched."
        widthClass="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setSettling(false)} className={btn}>
              Cancel
            </button>
            <button
              type="button"
              disabled={action.isLoading}
              onClick={async () => {
                if (await move('resolve_dispute', { note: outcome || undefined })) {
                  setSettling(false);
                  setOutcome('');
                }
              }}
              className={btnPrimary}
            >
              Settle the dispute
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">{data.dispute_reason}</p>
        <textarea
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          rows={4}
          placeholder="Describe the investigation and its outcome."
          className="mt-3 w-full rounded-xl border-0 bg-slate-100/80 p-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500"
        />
      </Modal>

      <Modal
        open={undoing}
        onClose={() => setUndoing(false)}
        icon={Ban}
        tone="red"
        title="Cancel Billing Run?"
        subtitle={
          data.sales_invoice
            ? `${data.name} and its ${
                data.is_credit_note ? 'credit note' : 'invoice'
              } ${data.sales_invoice} are cancelled together, or neither is.`
            : `${data.name} has drawn no accounting document. Only the run is cancelled.`
        }
        widthClass="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setUndoing(false)} className={btn}>
              Keep Billing Run
            </button>
            <button
              type="button"
              disabled={action.isLoading || !reason.trim()}
              onClick={async () => {
                if (await move('cancel', { reason })) {
                  setUndoing(false);
                  setReason('');
                }
              }}
              className={btnDanger}
            >
              {action.isLoading ? 'Cancelling…' : 'Cancel Billing Run'}
            </button>
          </div>
        }
      >
        {data.sales_invoice && data.invoice_submitted && (
          <p className="text-sm text-slate-600">
            {data.sales_invoice} is posted in ERPNext. It is cancelled there, through its own
            accounting checks, and this run is only cancelled if that succeeds.
          </p>
        )}
        {data.sales_invoice && !data.invoice_submitted && (
          <p className="text-sm text-slate-600">
            {data.sales_invoice} is still a draft, so it is deleted rather than cancelled:
            nothing of it was ever booked.
          </p>
        )}
        <label htmlFor="cancel-reason" className="mt-4 block text-sm font-medium text-slate-700">
          Cancellation reason
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="Why is this run being cancelled? Kept on the run's file."
          className="mt-1.5 w-full rounded-xl border-0 bg-slate-100/80 p-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1.5 text-xs text-slate-500">Required for the audit trail.</p>
      </Modal>

      <Modal
        open={reconciling}
        onClose={() => setReconciling(false)}
        icon={RefreshCw}
        tone="amber"
        title="Reconcile with ERPNext?"
        subtitle="The ledger is right about its own documents. This brings the run up to date and nothing else."
        widthClass="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setReconciling(false)} className={btn}>
              Leave it
            </button>
            <button
              type="button"
              disabled={action.isLoading}
              onClick={async () => {
                if (await move('reconcile', { apply: 1 })) setReconciling(false);
              }}
              className={btnPrimary}
            >
              {action.isLoading ? 'Reconciling…' : 'Reconcile the run'}
            </button>
          </div>
        }
      >
        <p className="text-sm font-medium text-slate-700">
          {data.accounting_mismatch?.message || 'This run agrees with ERPNext.'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Nothing is posted, re-posted or raised. The lines, the amounts and the period this run
          was drawn on are left exactly as they are.
        </p>
      </Modal>

      <InvoiceAccountingModal
        open={invoicing}
        run={data}
        loading={action.isLoading}
        error={action.error as Error | undefined}
        onClose={() => setInvoicing(false)}
        onConfirm={async (dimensions, exchangeRate) => {
          const step = data.can_approve ? 'finalise' : 'invoice';

          if (
            await move(step, {
              dimensions: JSON.stringify(dimensions),
              ...(exchangeRate ? { exchange_rate: exchangeRate } : {}),
            })
          ) {
            setInvoicing(false);
          }
        }}
      />

      <NotifyRecipientsModal
        open={telling}
        run={name}
        confirmLabel={data.is_credit_note ? 'Submit credit note' : 'Submit invoice'}
        busy={action.isLoading}
        onCancel={() => setTelling(false)}
        onConfirm={async (recipients) => {
          if (
            await move('submit_invoice', {
              notify: recipients.length ? 1 : 0,
              recipients: JSON.stringify(recipients),
            })
          ) {
            setTelling(false);
          }
        }}
      />
    </div>
  );
}

const LineRow = ({
  line,
  currency,
  customer,
  canDiscount,
  canRemove,
  onDiscount,
  onRemove,
}: {
  line: BillingRunLine;
  currency: string;
  customer: string;
  canDiscount: boolean;
  canRemove: boolean;
  onDiscount: (percent: number) => void;
  onRemove: () => void;
}) => {
  // who the line is about, and the machine it sits on when that is not the same thing
  const subject = subjectOf(line, customer);
  const under = line.hostname && line.hostname !== subject ? line.hostname : line.department;

  return (
    <tr className={line.exception_code ? 'bg-amber-50/40 transition-colors hover:bg-amber-50/70' : rowClass}>
      <Td className="max-w-[16rem] whitespace-normal">
        <p className="truncate text-sm font-semibold text-slate-900">{line.service_name}</p>
        <p className="truncate text-xs text-slate-400">{line.service_assignment}</p>
      </Td>
      <Td className="max-w-[14rem] whitespace-normal">
        <p className="truncate text-sm text-slate-700">{subject}</p>
        {under && <p className="truncate text-xs text-slate-400">{under}</p>}
      </Td>
      <Td className="whitespace-normal tabular-nums">
        {line.segments && line.segments.length > 1 ? (
          <div className="space-y-0.5">
            {line.segments.map((segment) => (
              <p key={segment.from}>
                {segment.from} <span className="text-slate-300">→</span> {segment.to}
              </p>
            ))}
            <Pill tone="amber">Suspended days excluded</Pill>
          </div>
        ) : line.covered_from ? (
          <>
            {String(line.covered_from).slice(0, 10)} <span className="text-slate-300">→</span>{' '}
            {String(line.covered_to).slice(0, 10)}
          </>
        ) : (
          '—'
        )}
      </Td>
      <Td align="right" className="tabular-nums">
        {line.billable_months}
        {/* a quantity other than one is what the months are multiplied by, and it is not
            months: a block of storage billed by the terabyte says so here or nowhere */}
        {line.quantity !== 1 && (
          <p className="text-xs text-slate-400">
            × {line.quantity}
            {line.uom ? ` ${line.uom}` : ''}
          </p>
        )}
      </Td>
      <Td align="right" className="tabular-nums">
        {line.exception_code || line.unit_rate === null ? '—' : line.unit_rate.toLocaleString()}
      </Td>
      <Td align="right">
        {canDiscount ? (
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            defaultValue={line.discount_percent || ''}
            onBlur={(event) => {
              const next = Number(event.target.value || 0);
              if (next !== line.discount_percent) onDiscount(next);
            }}
            placeholder="0"
            className="h-8 w-16 rounded-md border-0 bg-slate-100/80 px-2 text-right text-sm tabular-nums outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        ) : line.discount_percent ? (
          `${line.discount_percent}%`
        ) : (
          '—'
        )}
      </Td>
      <Td align="right" className="font-semibold tabular-nums text-slate-900">
        {money(line.amount, currency)}
      </Td>
      <Td className="max-w-[14rem] whitespace-normal">
        {line.exception_code ? (
          <div>
            <Pill tone="amber">{line.exception_code}</Pill>
            <p className="mt-1 text-xs text-slate-500">{line.exception_detail}</p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">{line.proration_method}</span>
        )}
      </Td>
      <Td align="right">
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Take this off the run. The service itself is untouched."
            aria-label={`Remove ${line.service_name} from this run`}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-transparent transition-colors hover:bg-red-50 hover:text-red-600 hover:ring-red-200"
          >
            Remove
          </button>
        )}
      </Td>
    </tr>
  );
};
