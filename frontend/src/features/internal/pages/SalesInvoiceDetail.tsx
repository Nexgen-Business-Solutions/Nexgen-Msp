import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Mail,
  Receipt,
  Scale,
  Wallet,
} from 'lucide-react';
import { salesInvoiceDeskUrl } from '@/lib/api/internal';
import { useSalesInvoice, useSendInvoiceEmail } from '../hooks/useBilling';
import { useMspContracts } from '../hooks/useMspContracts';
import NotifyRecipientsModal from '../components/NotifyRecipientsModal';
import PastCoverageModal from '../components/PastCoverageModal';
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
  Summary,
  Td,
  Th,
  btn,
  btnPrimary,
  rowClass,
} from '../components/billing/ui';
import { day, money } from '../components/billing/format';

const COLUMNS = ['Item', 'Description', 'Quantity', 'Rate', 'Amount'];

const statusTone = (status: string) =>
  ['Paid'].includes(status)
    ? ('green' as const)
    : ['Draft'].includes(status)
      ? ('gray' as const)
      : ['Unpaid', 'Overdue', 'Partly Paid'].includes(status)
        ? ('amber' as const)
        : status === 'Return' || status === 'Credit Note Issued'
          ? ('purple' as const)
          : ('blue' as const);

/**
 * One Sales Invoice as ERPNext holds it.
 *
 * Nothing here infers a billing run, a coverage or a payment that the document itself does
 * not carry. An invoice raised before this application existed says so, and the only thing
 * offered about it is the reconciliation that would make it mean something here.
 */
export default function SalesInvoiceDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const invoice = useSalesInvoice(name);
  const [reconciling, setReconciling] = useState(false);
  const [mailing, setMailing] = useState(false);
  // the one email this page sends, carried by the id that makes a double click one send
  const [attempt, setAttempt] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const sending = useSendInvoiceEmail();
  const contracts = useMspContracts(reconciling ? {} : { status: '__none__' });

  const data = invoice.data;

  if (invoice.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (invoice.error || !data) {
    return (
      <div className="px-6 pb-6 pt-5">
        <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-5 text-sm text-red-700 ring-1 ring-red-100">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70 text-red-600 ring-1 ring-red-100">
            <AlertCircle className="size-[18px]" strokeWidth={1.75} />
          </span>
          <span className="self-center">
            {(invoice.error as Error)?.message || 'Sales Invoice not found.'}
          </span>
        </div>
      </div>
    );
  }

  const currency = data.currency;

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
                data.is_return
                  ? 'bg-violet-50 text-violet-600 ring-violet-100'
                  : 'bg-emerald-50 text-emerald-600 ring-emerald-100'
              }`}
            >
              <Receipt className="size-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900">
                  {data.name}
                </h1>
                <Pill tone={statusTone(data.status)}>{data.status}</Pill>
                {data.is_return && <Pill tone="purple">Credit / Return</Pill>}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
                <Building2 size={14} className="shrink-0 text-slate-400" strokeWidth={1.75} />
                Sales Invoice · {data.customer_name || data.customer}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            {/* a posted invoice can be sent again from here: the document already exists,
                so nothing is drawn, approved or posted by writing to somebody about it */}
            {data.docstatus === 1 && (
              <button
                type="button"
                onClick={() => {
                  setQueued(null);
                  sending.reset();
                  setAttempt(`${data.name}-${Date.now()}`);
                  setMailing(true);
                }}
                className={btn}
              >
                <Mail size={14} />
                Send by email
              </button>
            )}
            <a href={salesInvoiceDeskUrl(data.name)} target="_blank" rel="noreferrer" className={btn}>
              Open in ERPNext ↗
            </a>
            {data.billing_run && (
              <button
                type="button"
                onClick={() => navigate(`/msp/billing/${data.billing_run}`)}
                className={btnPrimary}
              >
                View billing run →
              </button>
            )}
          </div>
        </div>

        <ContextBar
          facts={[
            { label: 'Customer', value: data.customer_name || data.customer },
            { label: 'Company', value: data.company },
            { label: 'Invoice date', value: day(data.posting_date) },
            { label: 'Source', value: data.origin === 'MSP' ? 'MSP billing' : 'ERPNext' },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-6 xl:grid-cols-4">
        <Metric
          icon={Wallet}
          tone={data.is_return ? 'purple' : 'blue'}
          label="Total"
          value={money(data.signed_total, currency)}
          hint={data.is_credit_note ? 'credited back, including taxes' : 'including taxes'}
        />
        <Metric
          icon={CircleDollarSign}
          tone={data.signed_outstanding ? 'amber' : 'green'}
          label="Outstanding"
          value={money(data.signed_outstanding, currency)}
          hint="as ERPNext holds it"
        />
        <Metric
          icon={CalendarDays}
          tone="gray"
          label="Due date"
          value={day(data.due_date)}
          hint={data.payment_terms_template ?? undefined}
        />
        <Metric
          icon={Scale}
          tone={statusTone(data.status)}
          label="Status"
          value={data.status}
          hint={data.docstatus === 1 ? 'submitted' : 'draft'}
        />
      </div>

      {!data.billing_run && (
        <Banner tone="blue" title="Invoice without an MSP billing run.">
          It is part of the accounting history. Listing it here does not mark any assignment as
          billed; its service coverage is reconciled separately.
          <button
            type="button"
            onClick={() => setReconciling(true)}
            className="ml-1 font-semibold underline underline-offset-2 hover:no-underline"
          >
            Review coverage →
          </button>
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHead
            title="Invoice lines"
            hint="From the ERPNext Sales Invoice, exactly as the document carries them."
            count={data.items.length}
            right={
              <Pill tone={data.is_return ? 'purple' : 'blue'}>
                {data.is_return ? 'Credit / Return' : 'Sales Invoice'}
              </Pill>
            }
          />
          <div className="max-h-[52vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {COLUMNS.map((column, index) => (
                    <Th key={column} align={index >= 2 ? 'right' : 'left'}>
                      {column}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.length === 0 && (
                  <Empty span={COLUMNS.length} icon={Receipt}>
                    No line on this document.
                  </Empty>
                )}
                {data.items.map((item, index) => (
                  <tr key={`${item.item_code}-${index}`} className={rowClass}>
                    <Td className="font-semibold text-slate-900">{item.item_code}</Td>
                    <Td className="max-w-[22rem] whitespace-normal">{item.description || '—'}</Td>
                    <Td align="right" className="tabular-nums">
                      {item.qty} {item.uom ?? ''}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {money(item.rate, currency)}
                    </Td>
                    <Td align="right" className="font-semibold tabular-nums text-slate-900">
                      {money(
                        data.is_credit_note ? -Math.abs(item.amount) : item.amount,
                        currency
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Foot
            left={`Net ${money(data.signed_net_total, currency)} · taxes ${money(
              data.total_taxes_and_charges,
              currency
            )}`}
            right={
              <strong className="text-base font-semibold tabular-nums text-slate-900">
                {money(data.signed_total, currency)}
              </strong>
            }
          />
        </Card>

        <div className="space-y-6">
          <InfoPanel>
            <PanelTitle>Invoice details</PanelTitle>
            <Summary
              rows={[
                { label: 'Company', value: data.company },
                { label: 'Currency', value: currency },
                { label: 'Exchange rate', value: data.conversion_rate || '—' },
                { label: 'Payment terms', value: data.payment_terms_template || '—' },
                { label: 'Cost center', value: data.cost_center || '—' },
                { label: 'Source', value: data.origin === 'MSP' ? 'MSP billing' : 'ERPNext historical' },
                {
                  label: 'Billing run',
                  value: data.billing_run ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/billing/${data.billing_run}`)}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {data.billing_run}
                    </button>
                  ) : (
                    'None'
                  ),
                },
              ]}
            />

            {data.payment_schedule.length > 0 && (
              <>
                <Divider />
                <PanelTitle>Payment schedule</PanelTitle>
                <Summary
                  rows={data.payment_schedule.map((row) => ({
                    label: day(row.due_date),
                    value: money(row.payment_amount, currency),
                  }))}
                />
              </>
            )}
          </InfoPanel>

          {(data.returns.length > 0 || data.returned_against) && (
            <InfoPanel>
              <PanelTitle>Credit notes</PanelTitle>
              {data.returned_against && (
                <Summary
                  rows={[
                    {
                      label: 'Returned against',
                      value: (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/msp/billing/invoices/${encodeURIComponent(
                                data.returned_against?.name as string
                              )}`
                            )
                          }
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {data.returned_against.name}
                        </button>
                      ),
                    },
                  ]}
                />
              )}
              {data.returns.map((entry) => (
                <div key={entry.name} className="mt-2.5 flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/msp/billing/invoices/${encodeURIComponent(entry.name)}`)
                    }
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {entry.name}
                  </button>
                  <span className="text-slate-500 tabular-nums">
                    {money(-Math.abs(entry.grand_total), currency)}
                  </span>
                  <Pill tone={entry.docstatus === 1 ? 'green' : 'gray'}>{entry.status}</Pill>
                </div>
              ))}
            </InfoPanel>
          )}
        </div>
      </div>

      <PastCoverageModal
        open={reconciling}
        customers={[...new Set((contracts.data ?? []).map((row) => row.customer))]
          .sort()
          .map((value) => ({ value, label: value }))}
        defaultCustomer={data.customer}
        onClose={() => setReconciling(false)}
        onRecorded={(run) => {
          setReconciling(false);
          navigate(`/msp/billing/${run}`);
        }}
      />

      {/* the choice the billing run already offers, on an invoice that needs no run */}
      <NotifyRecipientsModal
        open={mailing}
        invoice={data.name}
        title="Send this invoice"
        subtitle="The billing contact is written to; anyone else chosen is copied."
        confirmLabel="Send invoice"
        requireRecipient
        busy={sending.isPending}
        result={queued}
        error={sending.error instanceof Error ? sending.error.message : null}
        onCancel={() => setMailing(false)}
        onConfirm={async (recipients) => {
          setQueued(null);
          const sent = await sending.mutateAsync({
            name: data.name,
            recipients,
            request_id: attempt,
          });
          setQueued(
            `Queued for sending to ${sent.to.join(', ')}${
              sent.cc.length ? `, copied to ${sent.cc.join(', ')}` : ''
            }. The email queue says when it has gone out.`
          );
        }}
      />
    </div>
  );
}
