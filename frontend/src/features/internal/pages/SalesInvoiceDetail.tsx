import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { salesInvoiceDeskUrl } from '@/lib/api/internal';
import { useSalesInvoice } from '../hooks/useBilling';
import { useMspContracts } from '../hooks/useMspContracts';
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
  const contracts = useMspContracts(reconciling ? {} : { status: '__none__' });

  const data = invoice.data;

  if (invoice.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (invoice.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(invoice.error as Error)?.message || 'Sales Invoice not found.'}
        </div>
      </div>
    );
  }

  const currency = data.currency;
  const sign = data.is_return ? '−' : '';

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
              <Pill tone={statusTone(data.status)}>{data.status}</Pill>
              {data.is_return && <Pill tone="purple">Credit / Return</Pill>}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Sales Invoice · {data.customer_name || data.customer}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total" value={`${sign}${money(data.grand_total, currency)}`} hint="including taxes" />
        <Metric label="Outstanding" value={money(data.outstanding_amount, currency)} hint="as ERPNext holds it" />
        <Metric label="Due date" value={day(data.due_date)} hint={data.payment_terms_template ?? undefined} />
        <Metric label="Status" value={data.status} hint={data.docstatus === 1 ? 'submitted' : 'draft'} />
      </div>

      {!data.billing_run && (
        <Banner tone="blue" title="Invoice without an MSP billing run.">
          It is part of the accounting history. Listing it here does not mark any assignment as
          billed; its service coverage is reconciled separately.
          <button
            type="button"
            onClick={() => setReconciling(true)}
            className="ml-1 font-bold underline underline-offset-2"
          >
            Review coverage →
          </button>
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHead
            title="Invoice lines"
            hint="From the ERPNext Sales Invoice, exactly as the document carries them."
            right={<Pill tone={data.is_return ? 'purple' : 'blue'}>{data.is_return ? 'Credit / Return' : 'Sales Invoice'}</Pill>}
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
              <tbody>
                {data.items.length === 0 && <Empty span={COLUMNS.length}>No line on this document.</Empty>}
                {data.items.map((item, index) => (
                  <tr
                    key={`${item.item_code}-${index}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <Td className="font-bold text-slate-800">{item.item_code}</Td>
                    <Td className="max-w-[22rem] whitespace-normal">{item.description || '—'}</Td>
                    <Td align="right" className="tabular-nums">
                      {item.qty} {item.uom ?? ''}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {money(item.rate, currency)}
                    </Td>
                    <Td align="right" className="font-bold tabular-nums text-slate-800">
                      {sign}
                      {money(item.amount, currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Foot
            left={`Net ${money(data.net_total, currency)} · taxes ${money(data.total_taxes_and_charges, currency)}`}
            right={
              <strong className="text-sm font-bold text-slate-800">
                {sign}
                {money(data.grand_total, currency)}
              </strong>
            }
          />
        </Card>

        <div className="space-y-4">
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
                      className="font-bold text-blue-600 hover:underline"
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
                          className="font-bold text-blue-600 hover:underline"
                        >
                          {data.returned_against.name}
                        </button>
                      ),
                    },
                  ]}
                />
              )}
              {data.returns.map((entry) => (
                <div key={entry.name} className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/msp/billing/invoices/${encodeURIComponent(entry.name)}`)
                    }
                    className="font-bold text-blue-600 hover:underline"
                  >
                    {entry.name}
                  </button>
                  <span className="text-slate-500 tabular-nums">
                    −{money(entry.grand_total, currency)}
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
    </div>
  );
}
