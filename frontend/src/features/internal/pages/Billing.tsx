import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  Eye,
  FileSearch,
  FileText,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import Select from '@/shared/components/Select';
import TablePagination from '@/shared/components/TablePagination';
import { salesInvoiceDeskUrl } from '@/lib/api/internal';
import type { BillingAction, BillingWorkspaceRow } from '@/lib/api/internal';
import { useBillingWorkspace } from '../hooks/useBilling';
import { useMspContracts } from '../hooks/useMspContracts';
import PastCoverageModal from '../components/PastCoverageModal';
import {
  Card,
  CardHead,
  Empty,
  Foot,
  Pill,
  Td,
  Th,
  btn,
  btnPrimary,
} from '../components/billing/ui';
import { day, money } from '../components/billing/format';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses', tabs: ['runs', 'invoices'] },
  { value: 'open', label: 'Open / Draft', tabs: ['runs', 'invoices'] },
  { value: 'awaiting', label: 'Awaiting approval', tabs: ['runs'] },
  { value: 'posted', label: 'Posted / Paid', tabs: ['runs', 'invoices'] },
  { value: 'issue', label: 'Exceptions / Disputed', tabs: ['runs'] },
];

const RUN_COLUMNS = [
  'Run',
  'Customer',
  'Period',
  'Lines',
  'Exceptions',
  'Total',
  'Sales invoice',
  'Status',
  '',
];

const INVOICE_COLUMNS = [
  'Sales invoice',
  'Customer',
  'Posting / due date',
  'Total',
  'Outstanding',
  'Source',
  'MSP run',
  'Status',
  '',
];

/** What each proposed operation is called, and what its button offers to do about it. */
const OPERATIONS: Record<BillingAction['kind'], { label: string; tone: 'blue' | 'amber' | 'purple'; cta: string }> = {
  period: { label: 'Regular billing', tone: 'blue', cta: 'Prepare run' },
  additions: { label: 'Additions', tone: 'amber', cta: 'Bill additions' },
  credit_note: { label: 'Credit note', tone: 'purple', cta: 'Review credit' },
};

const statusTone = (status: string) => {
  if (['Paid', 'Invoiced'].includes(status)) return 'green' as const;
  // a document somebody stopped: said in the one colour nobody reads as progress
  if (status === 'Cancelled') return 'red' as const;
  if (['Draft', 'Validating', 'Invoice Drafted'].includes(status)) return 'gray' as const;
  if (['Unpaid', 'Overdue', 'Ready for Approval', 'Exception'].includes(status)) return 'amber' as const;
  if (status === 'Return' || status === 'Credit Note Issued') return 'purple' as const;

  return 'blue' as const;
};

/** Where a proposed operation stands today, which is what decides who opens it now. */
const actionState = (action: BillingAction) => {
  if (action.open_run) return { label: 'Draft in progress', tone: 'blue' as const };
  if (action.kind === 'credit_note') {
    return action.proven === false
      ? { label: 'Needs review', tone: 'amber' as const }
      : { label: 'Owed back', tone: 'gray' as const };
  }
  if (action.kind === 'additions') return { label: 'Left off the invoice', tone: 'gray' as const };
  if (action.state === 'Overdue') {
    return {
      label: action.days_left != null ? `Overdue · ${Math.abs(action.days_left)}d` : 'Overdue',
      tone: 'red' as const,
    };
  }
  if (action.state === 'Never billed') return { label: 'Never billed', tone: 'amber' as const };
  if (action.state === 'Due soon') {
    return {
      label: action.days_left != null ? `Due in ${action.days_left}d` : 'Due soon',
      tone: 'gray' as const,
    };
  }

  return { label: 'Scheduled', tone: 'gray' as const };
};

/**
 * Billing, as the approved R04 design draws it.
 *
 * The figures and the work waiting sit above two lists that answer two different
 * questions: what this application has drawn, and what the accounting desk holds whether
 * it drew it or not. Every operation starts from a line here and runs through one wizard.
 */
export default function Billing() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'runs' | 'invoices'>('runs');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [recording, setRecording] = useState(false);
  // only the reconciliation screen needs the list of companies, so it is read with it
  const contracts = useMspContracts(recording ? {} : { status: '__none__' });

  const workspace = useBillingWorkspace({
    tab,
    search: search.trim() || undefined,
    status: status || undefined,
    page,
  });

  const data = workspace.data;
  const figures = data?.figures;
  const totals = (figures?.invoiced_totals ?? []).map(
    (entry) => `${entry.amount.toLocaleString()} ${entry.currency}`.trim()
  );
  // a contract already covered well into the future is not work waiting to be done
  const actions = (data?.actions ?? []).filter(
    (action) => action.kind !== 'period' || action.state !== 'Scheduled' || action.open_run
  );
  const rows = data?.rows ?? [];
  const columns = tab === 'runs' ? RUN_COLUMNS : INVOICE_COLUMNS;

  const start = (operation: BillingAction) => {
    if (operation.open_run) {
      navigate(`/msp/billing/${encodeURIComponent(operation.open_run)}`);
      return;
    }

    // the window of the operation itself: a catch-up must never open on the next cycle.
    // A proposal raised here opens as the proposal it is — its lines ticked, waiting to be
    // validated — never as a blank charge for somebody to cut.
    navigate(
      `/msp/billing/new?kind=${operation.kind}` +
        `&contract=${encodeURIComponent(operation.contract)}` +
        `&start=${operation.period_start ?? operation.run_start}` +
        `&end=${operation.period_end ?? operation.run_end}` +
        (operation.kind === 'credit_note' ? '&scope=detected' : '') +
        (operation.run ? `&against=${encodeURIComponent(operation.run)}` : '')
    );
  };

  const look = (value: string) => {
    const next = value as 'runs' | 'invoices';
    const keeps = STATUS_FILTERS.find((entry) => entry.value === status);

    setTab(next);
    if (keeps && !keeps.tabs.includes(next)) setStatus('');
    setPage(1);
  };

  /** A figure and the rows behind it: the eye puts the list on exactly what it counted. */
  const narrow = (to: string) => {
    setTab('runs');
    setStatus(to);
    setPage(1);
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-400">Review upcoming billing and track invoices.</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* a charge raised before this application leaves nothing to credit against, so
              it is written down here first */}
          <button type="button" onClick={() => setRecording(true)} className={btn}>
            <FileSearch size={14} />
            Record past coverage
          </button>
          <button
            type="button"
            onClick={() => navigate('/msp/billing/new')}
            className={btnPrimary}
          >
            <Plus size={14} />
            New billing run
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={FileText}
          accent="blue"
          label="Billing runs"
          value={figures?.runs ?? 0}
          caption={`${figures?.settled ?? 0} invoiced or drafted`}
          loading={workspace.isLoading}
          onView={() => narrow('')}
          viewLabel="Show every run"
        />
        <KpiCard
          icon={Receipt}
          accent="emerald"
          label="Awaiting approval"
          value={figures?.awaiting ?? 0}
          caption="Validated and ready to freeze"
          loading={workspace.isLoading}
          onView={() => narrow('awaiting')}
          viewLabel="Show the runs awaiting approval"
        />
        <KpiCard
          icon={TriangleAlert}
          tone="alert"
          accent="slate"
          label="Runs with exceptions"
          value={figures?.blocked ?? 0}
          caption={`${figures?.blocked_lines ?? 0} lines to resolve`}
          loading={workspace.isLoading}
          onView={() => narrow('issue')}
          viewLabel="Show the runs to resolve"
        />
        <KpiCard
          icon={Wallet}
          accent="indigo"
          label="Invoiced total"
          value={totals[0] ?? '0'}
          caption={totals.length > 1 ? `+ ${totals.slice(1).join(' · ')}` : 'Across every run'}
          loading={workspace.isLoading}
          onView={() => narrow('posted')}
          viewLabel="Show the invoiced runs"
        />
      </div>

      {(workspace.isLoading || actions.length > 0) && (
        <Card>
          <CardHead
            title="Ready to bill"
            hint="Actions calculated from each contract's billing schedule and service history."
            right={
              <>
                <Pill tone="blue">
                  {workspace.isLoading
                    ? '…'
                    : `${actions.length} action${actions.length > 1 ? 's' : ''}`}
                </Pill>
                <button type="button" onClick={() => void workspace.refetch()} className={btn}>
                  <RefreshCw size={13} className={workspace.isFetching ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </>
            }
          />
          <div className="max-h-[52vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>What</Th>
                  <Th>Customer / contract</Th>
                  <Th>Period</Th>
                  <Th align="right">Lines</Th>
                  <Th align="right">Estimated amount</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {workspace.isLoading && <Empty span={7}>Reading the contracts…</Empty>}
                {actions.map((action) => {
                  const operation = OPERATIONS[action.kind];
                  const state = actionState(action);
                  const cta = action.open_run
                    ? 'Continue run'
                    : action.kind === 'additions' &&
                        !actions.some(
                          (other) => other.kind === 'period' && other.contract === action.contract
                        )
                      ? 'Bill additions'
                      : operation.cta;

                  return (
                    <tr
                      key={`${action.contract}-${action.kind}`}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                    >
                      <Td>
                        <Pill tone={operation.tone}>{operation.label}</Pill>
                      </Td>
                      <Td className="max-w-[20rem] whitespace-normal">
                        <p className="truncate text-xs font-bold text-slate-800">
                          {action.customer}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">
                          {[
                            action.contract,
                            [action.frequency, action.timing].filter(Boolean).join(' / '),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </Td>
                      <Td className="tabular-nums">
                        {day(action.period_start)} – {day(action.period_end)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {action.lines}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        <strong className="text-slate-800">
                          {action.amount === null
                            ? '—'
                            : money(action.amount, action.currency)}
                        </strong>
                      </Td>
                      <Td>
                        <Pill tone={state.tone}>{state.label}</Pill>
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() => start(action)}
                          className={
                            action.kind === 'period' && !action.open_run ? btnPrimary : btn
                          }
                        >
                          {cta} →
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-5">
          {(
            [
              ['runs', 'Billing runs', data?.counts.runs],
              ['invoices', 'Sales invoices', data?.counts.invoices],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => look(value)}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3.5 text-sm font-bold transition-colors ${
                tab === value
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
              {count !== undefined && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    tab === value ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={
                tab === 'runs'
                  ? 'Search a customer, a run or an invoice…'
                  : 'Search an invoice or a customer…'
              }
              className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none transition-colors focus:border-blue-400"
            />
          </div>
          <Select
            className="w-48"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUS_FILTERS.filter((entry) => entry.tabs.includes(tab)).map((entry) => ({
              value: entry.value,
              label: entry.label,
            }))}
          />
          <button type="button" onClick={() => void workspace.refetch()} className={btn}>
            <RefreshCw size={13} className={workspace.isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <Th
                    key={column || index}
                    align={
                      (tab === 'runs' && [3, 4, 5].includes(index)) ||
                      (tab === 'invoices' && [3, 4].includes(index))
                        ? 'right'
                        : 'left'
                    }
                  >
                    {column}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspace.isLoading && <Empty span={columns.length}>Loading…</Empty>}
              {workspace.error instanceof Error && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-5 py-12 text-center text-xs text-red-600"
                  >
                    {workspace.error.message}
                  </td>
                </tr>
              )}
              {!workspace.isLoading && !workspace.error && rows.length === 0 && (
                <Empty span={columns.length}>
                  {tab === 'runs' ? 'No run matches these filters.' : 'No invoice matches these filters.'}
                </Empty>
              )}
              {!workspace.isLoading &&
                rows.map((row) =>
                  tab === 'runs' ? (
                    <RunRow key={row.name} row={row} navigate={navigate} />
                  ) : (
                    <InvoiceRow key={row.name} row={row} navigate={navigate} />
                  )
                )}
            </tbody>
          </table>
        </div>

        <Foot
          left={
            tab === 'runs'
              ? `${data?.total ?? 0} billing run${(data?.total ?? 0) === 1 ? '' : 's'}`
              : `${data?.total ?? 0} sales invoice${(data?.total ?? 0) === 1 ? '' : 's'} · including those without an MSP run`
          }
          right={tab === 'runs' ? 'Runs prepared by MSP' : 'ERPNext Sales Invoice records'}
        />

        {(data?.total ?? 0) > (data?.page_length ?? 20) && (
          <div className="px-5 pb-4">
            <TablePagination
              start={((data?.page ?? 1) - 1) * (data?.page_length ?? 20)}
              pageLength={data?.page_length ?? 20}
              total={data?.total ?? 0}
              loading={workspace.isFetching}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </div>
        )}
      </Card>

      <PastCoverageModal
        open={recording}
        customers={[...new Set((contracts.data ?? []).map((row) => row.customer))]
          .sort()
          .map((value) => ({ value, label: value }))}
        onClose={() => setRecording(false)}
        onRecorded={(run) => {
          setRecording(false);
          navigate(`/msp/billing/${run}`);
        }}
      />
    </div>
  );
}

const RunRow = ({
  row,
  navigate,
}: {
  row: BillingWorkspaceRow;
  navigate: (to: string) => void;
}) => (
  <tr
    onClick={() => navigate(`/msp/billing/${row.name}`)}
    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
  >
    <Td>
      <p className="text-xs font-bold text-slate-800">{row.name}</p>
      <p className="text-[11px] text-slate-400">{row.kind}</p>
    </Td>
    <Td className="max-w-[16rem] truncate">{row.customer}</Td>
    <Td className="tabular-nums">
      {day(row.period_start)} – {day(row.period_end)}
    </Td>
    <Td align="right" className="tabular-nums">
      {row.lines}
    </Td>
    <Td align="right">
      {row.exceptions ? (
        <Pill tone="amber">{row.exceptions}</Pill>
      ) : (
        <span className="text-slate-300">—</span>
      )}
    </Td>
    <Td align="right" className="font-bold tabular-nums text-slate-800">
      {money(row.amount, row.currency)}
    </Td>
    <Td>{row.sales_invoice || <span className="text-slate-300">—</span>}</Td>
    <Td>
      <div className="flex items-center gap-1.5">
        <Pill tone={statusTone(row.status)}>{row.status}</Pill>
        {row.disputed && <Pill tone="red">Disputed</Pill>}
        {row.needs_reconciliation && (
          <Pill tone="amber" title="This run and ERPNext do not agree. Open it to reconcile.">
            Out of sync
          </Pill>
        )}
      </div>
    </Td>
    <Td align="right">
      <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
        <RowActionsMenu
          actions={[
            {
              label: 'View run',
              icon: Eye,
              onClick: () => navigate(`/msp/billing/${row.name}`),
            },
            {
              label: 'View sales invoice',
              icon: Receipt,
              disabled: !row.sales_invoice,
              onClick: () =>
                navigate(`/msp/billing/invoices/${encodeURIComponent(row.sales_invoice as string)}`),
            },
            {
              label: 'Customer and contract',
              icon: ExternalLink,
              onClick: () => navigate(`/msp/customers/${encodeURIComponent(row.customer)}`),
            },
          ]}
        />
      </div>
    </Td>
  </tr>
);

const InvoiceRow = ({
  row,
  navigate,
}: {
  row: BillingWorkspaceRow;
  navigate: (to: string) => void;
}) => (
  <tr
    onClick={() => navigate(`/msp/billing/invoices/${encodeURIComponent(row.name)}`)}
    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
  >
    <Td>
      <p className="text-xs font-bold text-slate-800">{row.name}</p>
      {row.is_return && <p className="text-[11px] font-semibold text-violet-600">Credit note</p>}
    </Td>
    <Td className="max-w-[16rem] truncate">{row.customer}</Td>
    <Td className="tabular-nums">
      {day(row.posting_date)}
      <span className="block text-[11px] text-slate-400">Due {day(row.due_date)}</span>
    </Td>
    <Td align="right" className="font-bold tabular-nums text-slate-800">
      {money(row.amount, row.currency)}
    </Td>
    <Td align="right" className="tabular-nums">
      {money(row.outstanding, row.currency)}
    </Td>
    <Td>
      <Pill tone={row.origin === 'MSP' ? 'blue' : 'gray'}>
        {row.origin === 'MSP' ? 'MSP billing' : 'ERPNext / historical'}
      </Pill>
    </Td>
    <Td>{row.billing_run || <span className="text-slate-300">—</span>}</Td>
    <Td>
      <Pill tone={statusTone(row.status)}>{row.status}</Pill>
    </Td>
    <Td align="right">
      <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
        <RowActionsMenu
          actions={[
            {
              label: 'View invoice',
              icon: Eye,
              onClick: () => navigate(`/msp/billing/invoices/${encodeURIComponent(row.name)}`),
            },
            {
              label: 'View billing run',
              icon: Receipt,
              disabled: !row.billing_run,
              onClick: () => navigate(`/msp/billing/${row.billing_run}`),
            },
            {
              label: 'Open in the accounting desk',
              icon: ExternalLink,
              onClick: () => window.open(salesInvoiceDeskUrl(row.name), '_blank'),
            },
          ]}
        />
      </div>
    </Td>
  </tr>
);
