import { useNavigate } from 'react-router-dom';
import { Eye, FileSpreadsheet, Printer, Receipt, Wallet } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import DataTable from '@/shared/components/DataTable';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { breakdownDownloadUrl, invoiceDownloadUrl } from '@/lib/api/portal';
import { usePortalBilling } from '../hooks/usePortal';

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
  const navigate = useNavigate();
  const billing = usePortalBilling();

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
          <tr
            key={row.name}
            onClick={() => navigate(`/msp/invoices/${row.name}`)}
            className="cursor-pointer transition-colors hover:bg-slate-50"
          >
            <td className="whitespace-nowrap px-4 py-3">
              <span className="text-sm font-semibold text-slate-900">
                {periodLabel(row.billing_period_start, row.billing_period_end)}
              </span>
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
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge value={row.invoice_docstatus === 1 ? 'Posted' : 'Draft'} />
                {Boolean(row.disputed) && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    DISPUTED
                  </span>
                )}
              </div>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
              {(row.total_amount || 0).toLocaleString()} {row.currency ?? ''}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'Open the invoice',
                      icon: Eye,
                      onClick: () => navigate(`/msp/invoices/${row.name}`),
                    },
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
        ))}
      </DataTable>
    </div>
  );
}
