import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ShieldCheck } from 'lucide-react';
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
  btnPrimary,
  btnWarn,
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
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (view.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(view.error as Error)?.message || 'Billing run not found.'}
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
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/billing')}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to billing
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-slate-900">{data.name}</h1>
              <Pill tone={KIND_TONE[data.kind] ?? 'gray'}>{data.kind}</Pill>
              <Pill tone={statusTone(data.status)}>{data.status}</Pill>
              {data.disputed && <Pill tone="red">Disputed</Pill>}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {data.customer} · {day(data.billing_period_start)} – {day(data.billing_period_end)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Amount"
          value={money(data.figures.amount, currency)}
          hint={data.is_credit_note ? 'credited back' : 'before taxes'}
        />
        <Metric
          label="Billing lines"
          value={data.figures.billed_lines}
          hint={`of ${data.figures.lines} · ${data.figures.months.toFixed(1)} months`}
        />
        <Metric
          label="Exceptions"
          value={data.figures.exceptions}
          hint={data.figures.exceptions ? 'to resolve before posting' : 'nothing held back'}
        />
        <Metric
          label="Sales invoice"
          value={data.sales_invoice ?? 'Not created'}
          hint={
            data.sales_invoice
              ? data.invoice_submitted
                ? 'posted in ERPNext'
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
              className="ml-1 font-bold underline underline-offset-2"
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
            className="ml-1 font-bold underline underline-offset-2"
          >
            Review credit →
          </button>
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHead
            title="Billing lines"
            hint="Quantities, coverage periods and service changes, as they were drawn."
            right={
              <button type="button" onClick={() => downloadBreakdownFile(data.name)} className={btn}>
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
              <tbody>
                {data.lines.length === 0 && <Empty span={COLUMNS.length}>Nothing on this run.</Empty>}
                {[...data.lines]
                  .sort((left, right) => Number(Boolean(right.exception_code)) - Number(Boolean(left.exception_code)))
                  .map((line) => (
                    <LineRow
                      key={line.service_assignment}
                      line={line}
                      currency={currency}
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
              <strong className="text-sm font-bold text-slate-800">
                {money(data.figures.amount, currency)}
              </strong>
            }
          />
        </Card>

        <div className="space-y-4">
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
                      className="font-bold text-blue-600 hover:underline"
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

            <Divider />
            <PanelTitle>Activity</PanelTitle>
            <ul className="space-y-2.5">
              {data.activity.map((event, index) => (
                <li key={`${event.label}-${index}`} className="flex gap-2.5 text-[11px] text-slate-500">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-300" />
                  <span>
                    {event.label}
                    {event.by && <span className="text-slate-400"> · {event.by}</span>}
                    {event.on && <span className="text-slate-400"> · {day(event.on)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </InfoPanel>

          {data.sales_invoice && <InvoicePanel run={data.name} isAdmin />}
        </div>
      </div>

      {action.error instanceof Error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
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
        <p className="text-xs text-slate-500">{data.dispute_reason}</p>
        <textarea
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          rows={4}
          placeholder="Describe the investigation and its outcome."
          className="mt-3 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-blue-400"
        />
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
  canDiscount,
  canRemove,
  onDiscount,
  onRemove,
}: {
  line: BillingRunLine;
  currency: string;
  canDiscount: boolean;
  canRemove: boolean;
  onDiscount: (percent: number) => void;
  onRemove: () => void;
}) => {
  // who the line is about, and the machine it sits on when that is not the same thing
  const subject = subjectOf(line);
  const under = line.hostname && line.hostname !== subject ? line.hostname : line.department;

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
      <Td className="max-w-[16rem] whitespace-normal">
        <p className="truncate text-xs font-bold text-slate-800">{line.service_name}</p>
        <p className="truncate text-[11px] text-slate-400">{line.service_assignment}</p>
      </Td>
      <Td className="max-w-[14rem] whitespace-normal">
        <p className="truncate text-xs text-slate-700">{subject}</p>
        {under && <p className="truncate text-[11px] text-slate-400">{under}</p>}
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
            className="h-8 w-16 rounded-md border border-slate-200 px-2 text-right text-xs tabular-nums outline-none focus:border-blue-400"
          />
        ) : line.discount_percent ? (
          `${line.discount_percent}%`
        ) : (
          '—'
        )}
      </Td>
      <Td align="right" className="font-bold tabular-nums text-slate-800">
        {money(line.amount, currency)}
      </Td>
      <Td className="max-w-[14rem] whitespace-normal">
        {line.exception_code ? (
          <div>
            <Pill tone="amber">{line.exception_code}</Pill>
            <p className="mt-1 text-[11px] text-slate-400">{line.exception_detail}</p>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">{line.proration_method}</span>
        )}
      </Td>
      <Td align="right">
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Take this off the run. The service itself is untouched."
            aria-label={`Remove ${line.service_name} from this run`}
            className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            Remove
          </button>
        )}
      </Td>
    </tr>
  );
};
