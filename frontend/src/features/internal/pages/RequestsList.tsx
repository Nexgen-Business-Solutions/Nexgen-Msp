import { useNavigate } from 'react-router-dom';
import * as internal from '@/lib/api/internal';
import { AlertTriangle, Clock, Eye, Inbox, Plus, Wrench } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import TablePagination from '@/shared/components/TablePagination';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import {
  useRequestFilterOptions,
  useRequestFilters,
  useRequestList,
  useRequestStats,
} from '../hooks/useRequests';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const COLUMNS = ['Request', 'Users', 'Customer', 'Type', 'Priority', 'Lines', 'Raised', 'Age', 'Status', ''];

const formatAge = (hours: number) => {
  if (hours === null || hours === undefined) return 'N/A';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
};

const openPath = (row: { name: string; billing_run: string | null }) =>
  row.billing_run ? `/msp/billing/${row.billing_run}` : `/msp/requests/${row.name}`;

export default function RequestsList() {
  const navigate = useNavigate();
  const { filters, patch, clear } = useRequestFilters();
  const options = useRequestFilterOptions();
  const statsParams = {
    search: filters.search || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    request_type: filters.request_type || undefined,
    customer: filters.customer || undefined,
    scope: filters.scope || undefined,
  };
  const stats = useRequestStats(statsParams);
  const list = useRequestList(filters);

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate('/msp/requests/new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus size={15} />
          New request
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Inbox}
          accent="blue"
          label="Open requests"
          value={stats.data?.open ?? 0}
          caption={`${stats.data?.awaiting_review ?? 0} not picked up yet`}
          loading={stats.isLoading}
          onView={() => patch({ scope: 'open', status: '' })}
          viewLabel="Show open requests"
        />
        <KpiCard
          icon={Wrench}
          accent="indigo"
          label="Under review"
          value={stats.data?.under_review ?? 0}
          caption={`${stats.data?.in_progress ?? 0} in progress`}
          loading={stats.isLoading}
          onView={() => patch({ scope: 'all', status: 'Under Review' })}
          viewLabel="Show requests under review"
        />
        <KpiCard
          icon={AlertTriangle}
          tone="alert"
          accent="slate"
          label="Urgent or high"
          value={stats.data?.urgent_open ?? 0}
          caption="Open requests needing attention first"
          loading={stats.isLoading}
          onView={() => patch({ scope: 'open', priority: 'Urgent' })}
          viewLabel="Show urgent requests"
        />
        <KpiCard
          icon={Clock}
          tone="alert"
          accent="slate"
          label="Ageing over 48h"
          value={stats.data?.ageing_open ?? 0}
          caption="Open requests older than two days"
          loading={stats.isLoading}
          onView={() => patch({ scope: 'open' })}
          viewLabel="Show open requests"
        />
      </div>

      <FilterBar
        values={filters as unknown as FilterState}
        search={filters.search}
        searchPlaceholder="Search a request, a customer or a requester…"
        subtitle="Narrow the request queue."
        onSearch={(value) => patch({ search: value })}
        onApply={(values) =>
          patch({
            status: (values.status as string) ?? '',
            priority: (values.priority as string) ?? '',
            request_type: (values.request_type as string) ?? '',
            customer: (values.customer as string) ?? '',
            scope: (values.scope as string) ?? '',
          })
        }
        onClear={clear}
        onRefresh={() => list.refetch()}
        onExport={() => internal.exportRequests(statsParams)}
        fields={[
          {
            key: 'customer',
            label: 'Customer',
            kind: 'select',
            allLabel: 'All customers',
            options: (options.data?.customers ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            allLabel: 'All statuses',
            options: (options.data?.statuses ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'priority',
            label: 'Priority',
            kind: 'select',
            allLabel: 'Any priority',
            options: (options.data?.priorities ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'request_type',
            label: 'Type',
            kind: 'select',
            allLabel: 'Any type',
            options: (options.data?.request_types ?? []).map((value) => ({
              value,
              label: value,
              description:
                value === 'Billing Dispute' ? 'An invoice the customer contests' : undefined,
            })),
          },
          {
            key: 'scope',
            label: 'Queue',
            kind: 'select',
            // 'open' is the landing state, so 'all' is what "no filter" means here
            clearValue: 'all',
            options: [
              { value: 'all', label: 'Everything' },
              { value: 'open', label: 'Open only', description: 'Still awaiting a decision' },
              { value: 'closed', label: 'Closed only', description: 'Already decided' },
              { value: 'mine', label: 'Assigned to me', description: 'Open and mine' },
            ],
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white pt-4 shadow-sm">
        <div className="max-h-[62vh] overflow-auto px-5 pb-1">
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
              {!!list.error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-red-600">
                    {(list.error as Error)?.message || 'Failed to load requests.'}
                  </td>
                </tr>
              )}

              {!list.error && list.isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!list.error && !list.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    No request matches these filters.
                  </td>
                </tr>
              )}

              {!list.error &&
                !list.isLoading &&
                rows.map((row) => (
                  <tr
                    key={row.name}
                    onClick={() => navigate(openPath(row))}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {row.name}
                    </td>
                    <td className="max-w-[16rem] px-4 py-3">
                      <p className="truncate text-sm font-medium text-slate-800" title={row.users ?? ''}>
                        {row.users || 'N/A'}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.customer}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge value={row.request_type} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge value={row.priority} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                        {row.line_count}
                      </span>
                      {row.pending_lines > 0 && (
                        <span className="ml-1.5 text-xs font-medium text-amber-600 tabular-nums">
                          {row.pending_lines} pending
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500 tabular-nums">
                      {fmtDate(row.creation)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500 tabular-nums">
                      {formatAge(row.age_hours)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge value={row.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'View request',
                              icon: Eye,
                              onClick: () => navigate(openPath(row)),
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

        <TablePagination
          start={filters.start}
          pageLength={filters.pageLength}
          total={list.data?.total ?? 0}
          loading={list.isLoading}
          onPrevious={() =>
            patch({ start: Math.max(filters.start - filters.pageLength, 0) }, true)
          }
          onNext={() => patch({ start: filters.start + filters.pageLength }, true)}
          onPageLengthChange={(size) => patch({ pageLength: size, start: 0 })}
        />
      </div>
    </div>
  );
}
