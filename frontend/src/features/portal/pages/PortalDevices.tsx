import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FilePlus2, Laptop, ShieldAlert, UserX } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiCard from '@/shared/components/KpiCard';
import { useDevicePage, usePortalFilterOptions, usePortalSummary, useSubscribedServices } from '../hooks/usePortal';

const COLUMNS = ['Machine', 'Held by', 'Since', 'Status', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const EMPTY: FilterState = { status: '', service: '' };

export default function PortalDevices() {
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
  const list = useDevicePage({
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
          icon={Laptop}
          accent="blue"
          label="Active machines"
          value={summary.data?.active_devices ?? 0}
          caption="Currently in service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Active' })}
        />
        <KpiCard
          icon={UserX}
          accent="indigo"
          label="Retired"
          value={(summary.data?.devices ?? 0) - (summary.data?.active_devices ?? 0)}
          caption="Taken out of service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Retired' })}
        />
        <KpiCard
          icon={ShieldAlert}
          tone="alert"
          accent="slate"
          label="Unprotected"
          value={summary.data?.unprotected_devices ?? 0}
          caption="Active with no security service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Active' })}
        />
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a hostname or a serial…"
        subtitle="Every machine we look after for you."
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
            options: (filterOptions.data?.device_statuses ?? []).map((value) => ({
              value,
              label: value,
            })),
          },
        ]}
      />

      <DataTable
        title="Machines"
        columns={COLUMNS}
        rowCount={rows.length}
        isLoading={list.isLoading}
        error={list.error}
        emptyLabel="No machine matches these filters."
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
              <p className="text-sm font-semibold text-slate-900">{row.hostname}</p>
              {row.serial_number ? (
                <p className="mt-0.5 font-mono text-xs text-slate-500">{row.serial_number}</p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-300">No serial</p>
              )}
              <p className="text-xs text-slate-400">{row.device_type}</p>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm">
              {row.assigned_client_user ? (
                <button
                  type="button"
                  onClick={() => navigate(`/msp/users/${row.assigned_client_user}`)}
                  className="text-blue-600 transition-colors hover:text-blue-800 hover:underline"
                >
                  {row.assigned_user_name || row.assigned_client_user}
                </button>
              ) : (
                <span className="text-slate-400">Nobody</span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
              {fmtDate(row.assigned_date)}
            </td>
            <td className="px-4 py-3">
              <StatusBadge value={row.status} />
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'Raise a request for this machine',
                      icon: FilePlus2,
                      onClick: () =>
                        navigate(`/msp/requests/new?device=${encodeURIComponent(row.name)}`),
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
