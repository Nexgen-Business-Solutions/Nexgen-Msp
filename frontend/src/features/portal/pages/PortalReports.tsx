import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { useReportFilterOptions, useReportRows } from '../hooks/usePortal';

const COLUMNS = [
  'User',
  'Service',
  'Device',
  'Department',
  'Since',
  'Ended',
  'Last billed',
  'Status',
  '',
];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const EMPTY: FilterState = {
  service_item: '',
  status: '',
  department: '',
  user_status: '',
  last_billed_after: '',
  last_billed_before: '',
};

export default function PortalReports() {
  const navigate = useNavigate();
  const options = useReportFilterOptions();

  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(0);
  const [pageLength, setPageLength] = useState(20);

  const query = {
    service_item: (filters.service_item as string) || undefined,
    status: (filters.status as string) || undefined,
    department: (filters.department as string) || undefined,
    user_status: (filters.user_status as string) || undefined,
    last_billed_after: (filters.last_billed_after as string) || undefined,
    last_billed_before: (filters.last_billed_before as string) || undefined,
    search: search || undefined,
    start,
    page_length: pageLength,
  };

  const list = useReportRows(query);
  const rows = list.data?.rows ?? [];

  const apply = (values: FilterState) => {
    setFilters(values);
    setStart(0);
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a person or a machine…"
        subtitle="Narrow everything your company holds."
        onSearch={(value) => {
          setSearch(value);
          setStart(0);
        }}
        onApply={apply}
        onClear={() => apply(EMPTY)}
        onRefresh={() => list.refetch()}
        fields={[
          {
            key: 'service_item',
            label: 'Service',
            kind: 'select',
            allLabel: 'All services',
            options: options.data?.services ?? [],
          },
          {
            key: 'status',
            label: 'Service status',
            kind: 'select',
            allLabel: 'Any status',
            options: (options.data?.statuses ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'department',
            label: 'Department',
            kind: 'select',
            allLabel: 'All departments',
            options: (options.data?.departments ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'user_status',
            label: 'Person status',
            kind: 'select',
            allLabel: 'Any person status',
            options: (options.data?.user_statuses ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'last_billed',
            label: 'Last billed between',
            kind: 'daterange',
            fromKey: 'last_billed_after',
            toKey: 'last_billed_before',
          },
        ]}
      />

      <DataTable
        title="Services"
        columns={COLUMNS}
        rowCount={rows.length}
        isLoading={list.isLoading}
        error={list.error}
        emptyLabel="Nothing matches these filters."
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
      >
        {rows.map((row) => (
          <tr key={row.name} className="transition-colors hover:bg-slate-50">
            <td className="whitespace-nowrap px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{row.user_name || 'N/A'}</p>
              {row.email && <p className="text-xs text-slate-400">{row.email}</p>}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
              {row.service_name}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.hostname || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.department || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
              {fmtDate(row.effective_start_date)}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
              {row.effective_end_date ? fmtDate(row.effective_end_date) : '—'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
              {row.last_billed_on ? fmtDate(row.last_billed_on) : 'Never'}
            </td>
            <td className="px-4 py-3">
              <StatusBadge value={row.operational_status} />
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'View profile',
                      icon: Eye,
                      disabled: !row.client_user,
                      onClick: () => navigate(`/msp/users/${row.client_user}`),
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
