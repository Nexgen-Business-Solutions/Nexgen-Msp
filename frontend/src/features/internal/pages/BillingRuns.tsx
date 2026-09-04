import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  Eye,
  FileText,
  Layers,
  Play,
  Plus,
  Receipt,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import { useBillingDue, useBillingRuns } from '../hooks/useBilling';
import { useMspContracts } from '../hooks/useMspContracts';

const COLUMNS = ['Run', 'Customer', 'Period', 'Lines', 'Exceptions', 'Total', 'Invoice', 'Status', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

type Range = { label: string; from: Date | null };

// a run belongs to the window its period ends in, which is when it was actually billed
const RUN_STATUSES = [
  'Draft',
  'Validating',
  'Exception',
  'Ready for Approval',
  'Approved',
  'Invoice Drafted',
  'Invoiced',
  'Cancelled',
];

const RANGES: Range[] = [
  { label: 'This month', from: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
  {
    label: 'This quarter',
    from: new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1),
  },
  { label: 'This year', from: new Date(new Date().getFullYear(), 0, 1) },
  { label: 'All time', from: null },
];

export default function BillingRuns() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const customerFilter = searchParams.get('customer') ?? undefined;
  const [filters, setFilters] = useState<FilterState>({
    customers: customerFilter ? [customerFilter] : [],
    statuses: [],
    period_from: '',
    period_to: '',
    focus: '',
  });
  const [search, setSearch] = useState('');

  const query = {
    customers: filters.customers as string[],
    statuses: filters.statuses as string[],
    period_from: (filters.period_from as string) || undefined,
    period_to: (filters.period_to as string) || undefined,
    search: search || undefined,
  };

  const { data, isLoading, error, refetch } = useBillingRuns(query);
  // the cards describe every run in the range; a filter narrows the list below, never them
  const everything = useBillingRuns({ customers: [], statuses: [] });
  const due = useBillingDue();
  const contracts = useMspContracts({});
  const [range, setRange] = useState(RANGES[0].label);

  const customerOptions = [...new Set((contracts.data ?? []).map((row) => row.customer))]
    .sort()
    .map((value) => ({ value, label: value }));

  // a contract already covered well into the future needs no attention today
  const dueRows = (due.data?.rows ?? []).filter((row) => row.state !== 'Scheduled');

  const rows = data?.rows ?? [];
  const window = RANGES.find((entry) => entry.label === range) ?? RANGES[0];
  const inRange = (list: typeof rows) =>
    window.from ? list.filter((row) => new Date(row.billing_period_end) >= (window.from as Date)) : list;

  const scoped = inRange(everything.data?.rows ?? []);
  const listed = inRange(rows);

  // the table lists what the cards count: the range, and whatever card was clicked
  const shown = filters.focus === 'exceptions' ? listed.filter((row) => row.exception_count > 0) : listed;
  const invoiced = scoped.filter((row) => row.status === 'Invoiced');
  const blocked = scoped.filter((row) => row.exception_count > 0);
  const scopedLines = scoped.reduce((sum, row) => sum + (row.line_count || 0), 0);
  const blockedLines = scoped.reduce((sum, row) => sum + (row.exception_count || 0), 0);
  const awaiting = scoped.filter((row) => row.status === 'Ready for Approval');
  const invoicedTotal = invoiced.reduce((sum, row) => sum + (row.total_amount || 0), 0);
  const currency = scoped.find((row) => row.currency)?.currency ?? '';

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a run, a customer or an invoice…"
        subtitle="Narrow the billing runs."
        onSearch={setSearch}
        onApply={setFilters}
        onClear={() =>
          setFilters({ customers: [], statuses: [], period_from: '', period_to: '', focus: '' })
        }
        onRefresh={() => refetch()}
        fields={[
          {
            key: 'customers',
            label: 'Customers',
            kind: 'multiselect',
            options: customerOptions,
          },
          {
            key: 'statuses',
            label: 'Status',
            kind: 'multiselect',
            options: RUN_STATUSES.map((value) => ({ value, label: value })),
          },
          {
            key: 'period',
            label: 'Period ends between',
            kind: 'daterange',
            fromKey: 'period_from',
            toKey: 'period_to',
          },
          {
            key: 'focus',
            label: 'Focus',
            kind: 'select',
            allLabel: 'Everything',
            options: [{ value: 'exceptions', label: 'With exceptions', description: 'Blocked until resolved' }],
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((entry) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => setRange(entry.label)}
            className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
              entry.label === range
                ? 'bg-blue-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          icon={FileText}
          accent="blue"
          label="Billing runs"
          value={scoped.length}
          caption={`${invoiced.length} invoiced`}
          loading={isLoading}
        onView={() => setFilters({ ...filters, statuses: [], focus: '' })}
        />
        <KpiCard
          icon={Receipt}
          accent="emerald"
          label="Awaiting approval"
          value={awaiting.length}
          caption="Validated and ready to freeze"
          loading={isLoading}
        onView={() => setFilters({ ...filters, statuses: ['Ready for Approval'], focus: '' })}
        />
        <KpiCard
          icon={TriangleAlert}
          tone="alert"
          accent="slate"
          label="Runs with exceptions"
          value={blocked.length}
          caption="Blocked until resolved"
          loading={isLoading}
        onView={() => setFilters({ ...filters, statuses: [], focus: 'exceptions' })}
        />
        <KpiCard
          icon={Layers}
          accent="slate"
          label="Billing lines"
          value={scopedLines}
          caption={`${blockedLines} blocked by an exception`}
          loading={isLoading}
        onView={() => setFilters({ ...filters, statuses: [], focus: '' })}
        />
        <KpiCard
          icon={Wallet}
          accent="indigo"
          label="Invoiced total"
          value={`${invoicedTotal.toLocaleString()} ${currency}`.trim()}
          caption={range.toLowerCase() === 'all time' ? 'Across every run' : range}
          loading={isLoading}
        onView={() => setFilters({ ...filters, statuses: ['Invoiced'], focus: '' })}
        />
      </div>

      {dueRows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
                <CalendarClock size={16} className="text-amber-600" />
                Ready to bill
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Coverage read from the periods already invoiced.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              {dueRows.length} contract{dueRows.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="max-h-[62vh] overflow-auto px-5 pb-4">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
                <tr>
                  {['Customer', 'Covered until', 'Next period', 'Frequency', 'Billable', 'State', ''].map(
                    (column, index) => (
                      <th
                        key={column || index}
                        className="whitespace-nowrap px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        {column}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {dueRows.map((row) => (
                  <tr key={row.contract}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{row.customer}</p>
                      {row.title && <p className="text-xs text-slate-400">{row.title}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.covered_upto ? fmtDate(row.covered_upto) : 'Never billed'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                      {fmtDate(row.next_period_start)} → {fmtDate(row.next_period_end)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.billing_frequency}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                      {row.billable_assignments}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          row.state === 'Overdue'
                            ? 'bg-red-100 text-red-700'
                            : row.state === 'Never billed'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {row.state.toUpperCase()}
                        {row.days_left !== null && row.days_left < 0
                          ? ` · ${Math.abs(row.days_left)}d`
                          : ''}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/msp/billing/new?contract=${encodeURIComponent(row.contract)}` +
                                `&start=${row.next_period_start}&end=${row.next_period_end}`
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                        >
                          <Play size={13} />
                          Bill this period
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Billing runs</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              Each run freezes the quantities and rates of its period.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/msp/billing/new')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={15} />
            New run
          </button>
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
              {!!error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-red-600">
                    {(error as Error)?.message || 'Failed to load billing runs.'}
                  </td>
                </tr>
              )}

              {!error && isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!error && !isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    No billing run yet.
                  </td>
                </tr>
              )}

              {!error &&
                !isLoading &&
                shown.map((row) => (
                  <tr
                    key={row.name}
                    onClick={() => navigate(`/msp/billing/${row.name}`)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {row.name}
                      {Boolean(row.disputed) && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                          disputed
                        </span>
                      )}
                      {row.adjustment_of && (
                        <span className="ml-1.5 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                          adj
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.customer}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {fmtDate(row.billing_period_start)} → {fmtDate(row.billing_period_end)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                        {row.line_count}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.exception_count > 0 ? (
                        <span className="text-sm font-semibold text-amber-600 tabular-nums">
                          {row.exception_count}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">0</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
                      {(row.total_amount || 0).toLocaleString()} {row.currency ?? ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.sales_invoice || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge value={row.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'View run',
                              icon: Eye,
                              onClick: () => navigate(`/msp/billing/${row.name}`),
                            },
                            {
                              label: 'Contract and pricing',
                              icon: Receipt,
                              onClick: () =>
                                navigate(`/msp/customers/${encodeURIComponent(row.customer)}`),
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

    </div>
  );
}
