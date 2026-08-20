import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Eye, Inbox, Wrench } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import TablePagination from '@/shared/components/TablePagination';
import RequestFilterBar from '../components/RequestFilterBar';
import {
  useRequestFilterOptions,
  useRequestFilters,
  useRequestList,
  useRequestStats,
} from '../hooks/useRequests';

const COLUMNS = ['Request', 'Users', 'Customer', 'Type', 'Priority', 'Lines', 'Age', 'Status', ''];

const formatAge = (hours: number) => {
  if (hours === null || hours === undefined) return 'N/A';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
};

export default function RequestsList() {
  const navigate = useNavigate();
  const { filters, patch, clear, activeCount } = useRequestFilters();
  const options = useRequestFilterOptions();
  const stats = useRequestStats();
  const list = useRequestList(filters);

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
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

      <RequestFilterBar
        filters={filters}
        options={options.data}
        activeCount={activeCount}
        onPatch={patch}
        onClear={clear}
        onRefresh={() => list.refetch()}
      />

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto px-5 pb-1 pt-4">
          <table className="w-full">
            <thead className="bg-slate-50">
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
                    onClick={() => navigate(`/msp/requests/${row.name}`)}
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
                              onClick: () => navigate(`/msp/requests/${row.name}`),
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
