import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  Eye,
  FileSearch,
  FileText,
  Layers,
  Play,
  Plus,
  Receipt,
  Trash2,
  TriangleAlert,
  Undo2,
  UserPlus,
  Wallet,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import Select from '@/shared/components/Select';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import PastCoverageModal from '../components/PastCoverageModal';
import Modal from '@/shared/components/Modal';
import SectionIcon from '@/shared/components/SectionIcon';
import type { BillingAction } from '@/lib/api/internal';
import {
  useBillingDue,
  useBillingRuns,
  useDiscardBillingRun,
  usePrepareCredit,
} from '../hooks/useBilling';
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

/** A run nobody has approved and no invoice carries is still the preparer's to finish or drop. */
const unsettled = (row: { status: string; sales_invoice?: string | null }) =>
  !row.sales_invoice && ['Draft', 'Validating', 'Exception', 'Ready for Approval'].includes(row.status);

/** What each kind of work looks like, and what the button says to do about it. */
const ACTION_LOOK: Record<
  BillingAction['kind'],
  { label: string; cta: string; icon: typeof Undo2; badge: string }
> = {
  credit_note: {
    label: 'Credit note',
    cta: 'Create credit note',
    icon: Undo2,
    badge: 'bg-rose-50 text-rose-700',
  },
  additions: {
    label: 'Additions',
    cta: 'Bill with the period',
    icon: UserPlus,
    badge: 'bg-sky-50 text-sky-700',
  },
  period: { label: 'Period', cta: 'Bill period', icon: Play, badge: 'bg-slate-100 text-slate-700' },
};

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
  const [dropping, setDropping] = useState<string | null>(null);
  const discard = useDiscardBillingRun();

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
  // the past-invoice screen, opened bare from the header or already filled in from a
  // proposal that cannot be acted on until the coverage is written down
  const prepare = usePrepareCredit();
  const [recording, setRecording] = useState<
    boolean | { customer: string; from: string; to: string }
  >(false);
  const due = useBillingDue();
  const contracts = useMspContracts({});
  const [range, setRange] = useState(RANGES[0].label);

  const customerOptions = [...new Set((contracts.data ?? []).map((row) => row.customer))]
    .sort()
    .map((value) => ({ value, label: value }));

  // a contract already covered well into the future needs no attention today
  // one line per thing to do: the screen reads as a list of decisions, not of contracts
  const actions = (due.data?.actions ?? []).filter(
    (action) => action.kind !== 'period' || action.state !== 'Scheduled'
  );

  const startAction = async (action: BillingAction) => {
    // nothing of ours charged that period: the coverage the customer's own date stands
    // for is written down on the way, so the credit has a record to stand against
    if (action.kind === 'credit_note' && !action.run) {
      try {
        await prepare.mutateAsync(action.contract);
      } catch {
        // said under the table rather than swallowed
        return;
      }
    }

    // the run screen is where all of it lives; each action lands on its own thing rather
    // than on the screen that holds it
    navigate(
      `/msp/billing/new?contract=${encodeURIComponent(action.contract)}` +
        `&start=${action.run_start}&end=${action.run_end}` +
        (action.kind === 'credit_note' ? '&credit=1' : '')
    );
  };

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

      <div className="flex items-center justify-end">
        <Select
          className="w-44"
          value={range}
          onChange={setRange}
          options={RANGES.map((entry) => ({ value: entry.label, label: entry.label }))}
        />
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

      {/* the card is there from the first paint: the work to do is the first thing anybody
          reads on this screen, and it appearing late reads as there being none */}
      {(due.isLoading || actions.length > 0) && (
        <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <SectionIcon icon={CalendarClock} />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Ready to bill</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  Coverage read from the periods already invoiced.
                </p>
              </div>
            </div>
            {prepare.error instanceof Error && (
              <p role="alert" className="w-full rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {prepare.error.message}
              </p>
            )}
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {due.isLoading ? (
                <span className="inline-block h-3 w-16 animate-pulse rounded bg-slate-200 align-middle" />
              ) : (
                `${actions.length} action${actions.length > 1 ? 's' : ''}`
              )}
            </span>
          </div>

          {due.isLoading ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-11 animate-pulse rounded-lg bg-slate-100"
                  style={{ animationDelay: `${row * 120}ms` }}
                />
              ))}
            </div>
          ) : (
          <div className="max-h-[62vh] overflow-auto px-5 pb-4">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  {['What', 'Customer', 'Period', 'Lines', 'Amount', ''].map((column, index) => (
                    <th
                      key={column || index}
                      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                        index === 0 ? 'rounded-l-lg' : ''
                      } ${index === 5 ? 'rounded-r-lg' : ''} ${
                        index === 3 || index === 4 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {actions.map((action) => {
                  const look = ACTION_LOOK[action.kind];
                  // the arrivals ride with the period only when a period is due as well;
                  // alone, they are the invoice
                  const cta =
                    action.kind === 'additions' &&
                    !actions.some(
                      (other) => other.kind === 'period' && other.contract === action.contract
                    )
                      ? 'Bill additions'
                      : look.cta;

                  return (
                    <tr key={`${action.contract}-${action.kind}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${look.badge}`}
                        >
                          <look.icon size={12} />
                          {look.label}
                        </span>
                      </td>
                      <td className="max-w-[18rem] px-4 py-3">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {action.customer}
                        </p>
                        {action.title && (
                          <p className="truncate text-xs text-slate-400">{action.title}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                        {fmtDate(action.period_start)} → {fmtDate(action.period_end)}
                        {action.state && action.state !== 'Scheduled' && (
                          <span
                            className={`ml-2 text-xs font-semibold ${
                              action.state === 'Overdue' ? 'text-red-600' : 'text-amber-600'
                            }`}
                          >
                            {action.state}
                            {action.days_left != null && action.days_left < 0
                              ? ` · ${Math.abs(action.days_left)}d`
                              : ''}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-slate-600 tabular-nums">
                        {action.lines}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums">
                        {action.amount === null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span
                            className={
                              action.amount < 0
                                ? 'font-semibold text-rose-600'
                                : 'font-semibold text-slate-800'
                            }
                          >
                            {action.amount.toLocaleString()} {action.currency ?? ''}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => void startAction(action)}
                            disabled={prepare.isLoading}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
                              action.kind === 'period'
                                ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {cta}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
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
          <div className="flex flex-wrap items-center gap-2">
            {/* a charge raised before this application leaves nothing to credit against,
                so it can be written down here first */}
            <button
              type="button"
              onClick={() => setRecording(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <FileSearch size={15} />
              Record a past invoice
            </button>
            <button
              type="button"
              onClick={() => navigate('/msp/billing/new')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={15} />
              New run
            </button>
          </div>
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
                              label: unsettled(row) ? 'Continue this run' : 'View run',
                              icon: unsettled(row) ? Play : Eye,
                              onClick: () => navigate(`/msp/billing/${row.name}`),
                            },
                            {
                              label: 'Contract and pricing',
                              icon: Receipt,
                              onClick: () =>
                                navigate(`/msp/customers/${encodeURIComponent(row.customer)}`),
                            },
                            ...(unsettled(row)
                              ? [
                                  {
                                    label: 'Delete this run',
                                    icon: Trash2,
                                    danger: true,
                                    onClick: () => setDropping(row.name),
                                  },
                                ]
                              : []),
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
        open={Boolean(dropping)}
        onClose={() => setDropping(null)}
        icon={Trash2}
        tone="red"
        title="Delete this run?"
        subtitle="Nobody has approved it and no invoice carries it, so it leaves no trace. The period stays open and can be drawn again."
        widthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDropping(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={discard.isLoading}
              onClick={async () => {
                try {
                  await discard.mutateAsync(dropping as string);
                  setDropping(null);
                } catch {
                  return;
                }
              }}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              Delete run
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">{dropping}</p>
        {discard.error instanceof Error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
            {discard.error.message}
          </p>
        )}
      </Modal>

      <PastCoverageModal
        key={typeof recording === 'object' ? recording.customer : 'bare'}
        open={Boolean(recording)}
        customers={customerOptions}
        defaultCustomer={
          typeof recording === 'object' ? recording.customer : customerFilter
        }
        defaultPeriod={typeof recording === 'object' ? recording : null}
        onClose={() => setRecording(false)}
        onRecorded={(run) => {
          setRecording(false);
          navigate(`/msp/billing/${run}`);
        }}
      />
    </div>
  );
}
