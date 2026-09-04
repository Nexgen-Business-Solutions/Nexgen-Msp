import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FilePlus2, Laptop, ShieldAlert, UserX } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiCard from '@/shared/components/KpiCard';
import * as portal from '@/lib/api/portal';
import { useDevicePage, usePortalFilterOptions, usePortalSummary, useSubscribedServices } from '../hooks/usePortal';
import { useMyApprovalRights } from '../hooks/usePortal';

const COLUMNS = ['Device', 'Network interfaces', 'Active services', 'Inactive services', ''];

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const INTERFACE_ORDER = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const EMPTY: FilterState = { status: '', service: '' };

export default function PortalDevices() {
  const rights = useMyApprovalRights();
  const canSubmit = rights.data?.can_submit !== false;
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
          label="No service"
          value={summary.data?.devices_without_services ?? 0}
          caption="Active, with no active service"
          loading={summary.isLoading}
          onView={() => apply({ status: 'Active' })}
        />
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a hostname, a serial or a holder…"
        subtitle="Every machine we look after for you."
        onSearch={(value) => {
          setSearch(value);
          setStart(0);
        }}
        onApply={apply}
        onClear={() => apply(EMPTY)}
        onRefresh={() => list.refetch()}
        onExport={() =>
          portal.exportMyMachines({
            search: search || undefined,
            status: (filters.status as string) || undefined,
            service: (filters.service as string) || undefined,
          })
        }
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
              {row.assigned_client_user ? (
                <button
                  type="button"
                  onClick={() => navigate(`/msp/users/${row.assigned_client_user}`)}
                  className="text-xs text-blue-600 transition-colors hover:text-blue-800 hover:underline"
                >
                  {row.assigned_user_name || row.assigned_client_user}
                </button>
              ) : (
                <p className="text-xs text-slate-400">Unassigned</p>
              )}
              {row.serial_number ? (
                <p className="mt-0.5 font-mono text-xs text-slate-500">{row.serial_number}</p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-300">No serial</p>
              )}
              <p className="text-xs text-slate-400">{row.device_type}</p>
            </td>
            <td className="px-4 py-3">
              {row.interfaces?.length ? (
                <div className="space-y-1">
                  {[...row.interfaces]
                    .sort(
                      (a, b) =>
                        INTERFACE_ORDER.indexOf(a.interface_type) -
                        INTERFACE_ORDER.indexOf(b.interface_type)
                    )
                    .map((item) => (
                      <div
                        key={`${item.interface_type}-${item.mac_address}`}
                        className="flex items-baseline gap-3"
                      >
                        <span className="w-[5.5rem] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {INTERFACE_LABEL[item.interface_type] ?? item.interface_type}
                        </span>
                        <span className="font-mono text-xs tracking-tight text-slate-800">
                          {item.mac_address}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <span className="text-sm text-slate-400">N/A</span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 tabular-nums">
                {row.active_services}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <span
                className={`inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${
                  row.inactive_services
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-transparent text-slate-300'
                }`}
              >
                {row.inactive_services}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    ...(canSubmit
                      ? [
                    {
                      label: 'Raise a request for this machine',
                      icon: FilePlus2,
                      onClick: () =>
                        navigate(`/msp/requests/new?device=${encodeURIComponent(row.name)}`),
                    },
                        ]
                      : []),
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
