import { useScopedWorkspace } from '@/shared/layout/useScopedWorkspace';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, FilePlus2, ShieldCheck } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import {
  useMyApprovalRights,
  usePortalRequestList,
  usePortalRequestOptions,
} from '../hooks/usePortal';

const COLUMNS = ['Request', 'Type', 'Priority', 'Status', 'Raised', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const EMPTY: FilterState = { status: '', priority: '', request_type: '' };

export default function PortalRequests() {
  const scoped = useScopedWorkspace();
  const navigate = useNavigate();
  const options = usePortalRequestOptions();
  const rights = useMyApprovalRights();

  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(0);
  const [pageLength, setPageLength] = useState(20);

  const list = usePortalRequestList({
    status: (filters.status as string) || undefined,
    priority: (filters.priority as string) || undefined,
    request_type: (filters.request_type as string) || undefined,
    search: search || undefined,
    start,
    page_length: pageLength,
  });

  const rows = list.data?.rows ?? [];

  const apply = (values: FilterState) => {
    setFilters(values);
    setStart(0);
  };

  const awaiting = rights.data?.can_approve ? rights.data.awaiting : 0;

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      {awaiting > 0 && (
        <button
          type="button"
          onClick={() => apply({ ...EMPTY, status: 'Awaiting Customer Approval' })}
          className="group flex w-full flex-col gap-3 rounded-2xl bg-amber-50 px-5 py-4 text-left ring-1 ring-amber-200 transition-colors hover:bg-amber-100/60 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-amber-600 ring-1 ring-amber-200">
              <ShieldCheck className="size-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-amber-900">
                {awaiting} request{awaiting > 1 ? 's' : ''} waiting for your accord
              </span>
              <span className="mt-0.5 block text-sm text-amber-800">
                They reach Nexgen only once you have approved them.
              </span>
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-white px-3.5 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200 transition-colors group-hover:bg-amber-50 sm:self-auto">
            Review them
            <ArrowRight size={14} />
          </span>
        </button>
      )}

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a request…"
        subtitle="Narrow your requests."
        onSearch={(value) => {
          setSearch(value);
          setStart(0);
        }}
        onApply={apply}
        onClear={() => apply(EMPTY)}
        onRefresh={() => list.refetch()}
        fields={[
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
            options: (options.data?.request_types ?? []).map((value) => ({ value, label: value })),
          },
        ]}
      />

      <DataTable
        title="Requests"
        columns={COLUMNS}
        rowCount={rows.length}
        isLoading={list.isLoading}
        error={list.error}
        emptyLabel={
          search || Object.values(filters).some(Boolean)
            ? 'No request matches these filters.'
            : 'No request yet.'
        }
        showToolbar={false}
        start={start}
        pageLength={pageLength}
        total={list.data?.total ?? 0}
        onPrevious={() => setStart(Math.max(start - pageLength, 0))}
        onNext={() => setStart(start + pageLength)}
        onPageLengthChange={(size) => {
          setPageLength(size);
          setStart(0);
        }}
        action={
          scoped || rights.data?.can_submit !== true
            ? undefined
            : { label: 'New request', icon: FilePlus2, onClick: () => navigate('/msp/requests/new') }
        }
      >
        {rows.map((row) => (
          <tr
            key={row.name}
            onClick={() =>
              navigate(
                row.status === 'Draft' && !scoped
                  ? `/msp/requests/new?draft=${encodeURIComponent(row.name)}`
                  : `/msp/requests/${row.name}`
              )
            }
            className="cursor-pointer transition-colors hover:bg-slate-50/80"
          >
            <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
              {row.name}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
              {row.request_type}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <StatusBadge value={row.priority} />
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <StatusBadge value={row.status} />
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-500">
              {fmtDate(row.creation)}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'View request',
                      icon: Eye,
                      onClick: () => navigate(
                      row.status === 'Draft' && !scoped
                        ? `/msp/requests/new?draft=${encodeURIComponent(row.name)}`
                        : `/msp/requests/${row.name}`
                    ),
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
