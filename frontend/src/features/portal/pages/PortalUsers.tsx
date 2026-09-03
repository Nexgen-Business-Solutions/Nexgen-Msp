import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, FilePlus2, UserCheck, UserX, Users } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiCard from '@/shared/components/KpiCard';
import { useClientUserPage, usePortalFilterOptions, usePortalSummary, useSubscribedServices } from '../hooks/usePortal';

const COLUMNS = ['Person', 'Department', 'Email', 'Since', 'Status', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const EMPTY: FilterState = { status: '', service: '' };

export default function PortalUsers() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>({
    ...EMPTY,
    service: params.get('service') ?? '',
  });
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(0);
  const [pageLength, setPageLength] = useState(20);

  const summary = usePortalSummary();
  const services = useSubscribedServices();
  const filterOptions = usePortalFilterOptions();
  const list = useClientUserPage({
    search: search || undefined,
    status: (filters.status as string) || undefined,
    service: (filters.service as string) || undefined,
    start,
    page_length: pageLength,
  });

  const rows = list.data?.rows ?? [];

  const apply = (values: FilterState) => {
    setFilters(values);
    setStart(0);
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={Users}
          accent="blue"
          label="People"
          value={summary.data?.client_users ?? 0}
          caption="Everyone on file with us"
          loading={summary.isLoading}
          onView={() => apply(EMPTY)}
        />
        <KpiCard
          icon={UserCheck}
          accent="indigo"
          label="Active"
          value={summary.data?.active_client_users ?? 0}
          caption="Currently in service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Active' })}
        />
        <KpiCard
          icon={UserX}
          tone="alert"
          accent="slate"
          label="Disabled"
          value={(summary.data?.client_users ?? 0) - (summary.data?.active_client_users ?? 0)}
          caption="No longer in service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Disabled' })}
        />
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a name or an email…"
        subtitle="Everyone your company has with us."
        onSearch={(value) => {
          setSearch(value);
          setStart(0);
        }}
        onApply={apply}
        onClear={() => apply(EMPTY)}
        onRefresh={() => list.refetch()}
        fields={[
          {
            key: 'service',
            label: 'Service',
            kind: 'select',
            allLabel: 'Any service',
            options: (services.data?.services ?? []).map((row) => ({
              value: row.service_item,
              label: row.item_name,
            })),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            allLabel: 'Any status',
            options: (filterOptions.data?.user_statuses ?? []).map((value) => ({
              value,
              label: value,
            })),
          },
        ]}
      />

      <DataTable
        title="People"
        columns={COLUMNS}
        rowCount={rows.length}
        isLoading={list.isLoading}
        error={list.error}
        emptyLabel="Nobody matches these filters."
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
              <button
                type="button"
                onClick={() => navigate(`/msp/users/${row.name}`)}
                className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
              >
                {row.full_name}
              </button>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.department || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.email || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
              {fmtDate(row.start_date)}
            </td>
            <td className="px-4 py-3">
              <StatusBadge value={row.lifecycle_status} />
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'Open profile',
                      icon: Eye,
                      onClick: () => navigate(`/msp/users/${row.name}`),
                    },
                    {
                      label: 'Raise a request for them',
                      icon: FilePlus2,
                      onClick: () =>
                        navigate(`/msp/requests/new?client_user=${encodeURIComponent(row.name)}`),
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
