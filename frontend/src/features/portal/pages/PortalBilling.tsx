import { Fragment, useState } from 'react';
import { ChevronDown, FileSpreadsheet, Printer, Receipt, Wallet } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import DataTable from '@/shared/components/DataTable';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { breakdownDownloadUrl, invoiceDownloadUrl } from '@/lib/api/portal';
import { usePortalBilling, usePortalBillingDetail } from '../hooks/usePortal';

const COLUMNS = ['Period', 'Invoice', 'Services', 'Issued', 'Status', 'Total', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

// a link click is never caught by a popup blocker, unlike window.open
const download = (url: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const periodLabel = (start: string, end: string) => {
  const from = new Date(start);
  const to = new Date(end);

  if (from.getFullYear() === to.getFullYear() && to.getMonth() - from.getMonth() === 2) {
    return `Q${Math.floor(from.getMonth() / 3) + 1} ${from.getFullYear()}`;
  }

  return `${fmtDate(start)} → ${fmtDate(end)}`;
};

export default function PortalBilling() {
  const billing = usePortalBilling();
  const [expanded, setExpanded] = useState<string | null>(null);
  const detail = usePortalBillingDetail(expanded ?? undefined);

  const rows = billing.data ?? [];
  const total = rows.reduce((sum, row) => sum + (row.total_amount || 0), 0);
  const currency = rows[0]?.currency ?? '';

  return (
    <div className="space-y-6 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          icon={Receipt}
          accent="blue"
          label="Invoiced periods"
          value={rows.length}
          caption="Every period billed to your company"
          loading={billing.isLoading}
        />
        <KpiCard
          icon={Wallet}
          accent="emerald"
          label="Invoiced to date"
          value={Math.round(total).toLocaleString()}
          caption={currency}
          loading={billing.isLoading}
        />
        <KpiCard
          icon={FileSpreadsheet}
          accent="slate"
          label="Lines billed"
          value={rows.reduce((sum, row) => sum + (row.line_count || 0), 0)}
          caption="People and machines across all periods"
          loading={billing.isLoading}
        />
      </div>

      <DataTable
        title="Invoices"
        columns={COLUMNS}
        rowCount={rows.length}
        isLoading={billing.isLoading}
        error={billing.error}
        emptyLabel="No invoice yet."
        showToolbar={false}
        showPagination={false}
      >
        {rows.map((row) => (
          <Fragment key={row.name}>
            <tr
              onClick={() => setExpanded((current) => (current === row.name ? null : row.name))}
              className="cursor-pointer transition-colors hover:bg-slate-50"
            >
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex items-center gap-2">
                  <ChevronDown
                    size={15}
                    className={`text-slate-400 transition-transform ${
                      expanded === row.name ? 'rotate-180' : '-rotate-90'
                    }`}
                  />
                  <span className="text-sm font-semibold text-slate-900">
                    {periodLabel(row.billing_period_start, row.billing_period_end)}
                  </span>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                {row.sales_invoice || 'N/A'}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                {row.line_count}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                {fmtDate(row.posting_date)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge value={row.invoice_docstatus === 1 ? 'Posted' : 'Draft'} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
                {(row.total_amount || 0).toLocaleString()} {row.currency ?? ''}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex justify-end">
                  <RowActionsMenu
                    actions={[
                      {
                        label: 'Download invoice',
                        icon: Printer,
                        onClick: () => download(invoiceDownloadUrl(row.name)),
                      },
                      {
                        label: 'Download breakdown',
                        icon: FileSpreadsheet,
                        onClick: () => download(breakdownDownloadUrl(row.name)),
                      },
                    ]}
                  />
                </div>
              </td>
            </tr>

            {expanded === row.name && (
              <tr>
                <td colSpan={COLUMNS.length} className="bg-slate-50/70 px-4 py-4">
                  {detail.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

                  {detail.error instanceof Error && (
                    <p className="text-sm text-red-600">{detail.error.message}</p>
                  )}

                  {detail.data && (
                    <div className="space-y-4">
                      {detail.data.services.map((service) => (
                        <div
                          key={service.service_name}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                            <p className="text-sm font-semibold text-slate-900">
                              {service.service_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {service.quantity} billed · {service.months} months ·{' '}
                              <span className="font-semibold text-slate-800">
                                {service.amount.toLocaleString()} {row.currency ?? ''}
                              </span>
                            </p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead className="bg-slate-50">
                                <tr>
                                  {['User', 'Department', 'Device', 'From', 'To', 'Months', 'Amount'].map(
                                    (column, index) => (
                                      <th
                                        key={column}
                                        className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
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
                                    <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-800">
                                      {line.user_name || 'N/A'}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                                      {line.department || 'N/A'}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                                      {line.hostname || 'N/A'}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-500">
                                      {fmtDate(line.started_on)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-sm text-slate-500">
                                      {line.stopped_on ? fmtDate(line.stopped_on) : 'Active'}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-slate-700 tabular-nums">
                                      {line.billable_months}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold text-slate-900 tabular-nums">
                                      {line.amount.toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      <div className="flex flex-wrap gap-2">
                        <a
                          href={invoiceDownloadUrl(row.name)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <Printer size={15} />
                          Invoice PDF
                        </a>
                        <a
                          href={breakdownDownloadUrl(row.name)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <FileSpreadsheet size={15} />
                          Breakdown file
                        </a>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </DataTable>
    </div>
  );
}
