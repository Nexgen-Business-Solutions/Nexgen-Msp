import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FilePlus2, Laptop, ShieldAlert, UserX } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import ColumnsModal from '@/shared/components/ColumnsModal';
import { PORTAL_DEVICES, loadChoice } from '@/shared/exportColumns';
import { PORTAL_DEVICE_LIST } from '@/shared/listColumns';
import StatusBadge from '@/shared/components/StatusBadge';
import type { ManagedDevice } from '@/lib/api/portal';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiCard from '@/shared/components/KpiCard';
import * as portal from '@/lib/api/portal';
import { useDevicePage, usePortalFilterOptions, usePortalSummary, useSubscribedServices } from '../hooks/usePortal';
import { useMyApprovalRights } from '../hooks/usePortal';
import { usePortalFilters } from '../store/usePortalFilters';

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const INTERFACE_ORDER = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const EMPTY: FilterState = { status: '', service: '', coverage: '' };

export default function PortalDevices() {
  const [picking, setPicking] = useState(false);
  const [choosingColumns, setChoosingColumns] = useState(false);
  // what this person chose to see, kept in their browser
  const [shown, setShown] = useState(() => loadChoice(PORTAL_DEVICE_LIST).columns);
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
  // staff read a customer's fleet through the portal: the sheet is that customer's too
  const customer = usePortalFilters((state) => state.customer);
  const filterOptions = usePortalFilterOptions();
  const list = useDevicePage({
    search: search || undefined,
    status: (filters.status as string) || undefined,
    service: (filters.service as string) || undefined,
    coverage: (filters.coverage as string) || undefined,
    start,
    page_length: pageLength,
  });

  const rows = list.data?.rows ?? [];
  const labels = Object.fromEntries(PORTAL_DEVICE_LIST.columns.map((column) => [column.key, column.label]));

  const cell = (key: string, row: ManagedDevice) => {
    switch (key) {
      case 'device':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{row.hostname}</p>
            {row.serial_number ? (
              <p className="mt-0.5 font-mono text-xs text-slate-500">{row.serial_number}</p>
            ) : (
              <p className="mt-0.5 text-xs text-slate-300">No serial</p>
            )}
          </td>
        );
      case 'held_by':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            {row.assigned_client_user ? (
              <button
                type="button"
                onClick={() => navigate(`/msp/users/${row.assigned_client_user}`)}
                className="text-sm text-blue-600 transition-colors hover:text-blue-800 hover:underline"
              >
                {row.assigned_user_name || row.assigned_client_user}
              </button>
            ) : (
              <span className="text-sm text-slate-400">Unassigned</span>
            )}
          </td>
        );
      case 'status':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <StatusBadge value={row.status} />
          </td>
        );
      case 'interfaces':
        return (
          <td key={key} className="px-4 py-3">
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
        );
      case 'active_services':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 tabular-nums">
              {row.active_services}
            </span>
          </td>
        );
      case 'inactive_services':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span
              className={`inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${
                row.inactive_services ? 'bg-slate-100 text-slate-600' : 'bg-transparent text-slate-300'
              }`}
            >
              {row.inactive_services}
            </span>
          </td>
        );
      case 'assigned_date':
      case 'retired_date':
      case 'last_billed_on':
      case 'covered_until':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
            {row[key] ? String(row[key]).slice(0, 10) : 'N/A'}
          </td>
        );
      default: {
        const value = row[key as 'device_type' | 'user_department' | 'manufacturer' | 'model' | 'operating_system' | 'services'];

        return (
          <td key={key} className="px-4 py-3 text-sm text-slate-600">
            {value || <span className="text-slate-400">N/A</span>}
          </td>
        );
      }
    }
  };

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
          onView={() => apply({ ...EMPTY, status: 'Active' })}
        />
        <KpiCard
          icon={UserX}
          accent="indigo"
          label="Retired"
          value={summary.data?.retired_devices ?? 0}
          caption="Taken out of service"
          loading={summary.isLoading}
          onView={() => apply({ ...EMPTY, status: 'Retired' })}
        />
        <KpiCard
          icon={ShieldAlert}
          tone="alert"
          accent="slate"
          label="No service"
          value={summary.data?.devices_without_services ?? 0}
          caption="Active, with no active service"
          loading={summary.isLoading}
          onView={() => apply({ ...EMPTY, coverage: 'no_service' })}
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
        onExport={() => setPicking(true)}
        onColumns={() => setChoosingColumns(true)}
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
          {
            key: 'coverage',
            label: 'Coverage',
            kind: 'select',
            allLabel: 'Any',
            options: [{ value: 'no_service', label: 'No active service' }],
          },
        ]}
      />

      <DataTable
        title="Machines"
        columns={[...shown.map((key) => labels[key]), '']}
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
            {shown.map((key) => cell(key, row))}
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    ...(canSubmit
                      ? [
                    {
                      label: 'Raise a request for this machine',
                      icon: FilePlus2,
                      // a request is about a person: whoever holds the machine, or somebody
                      // new when nobody does — and the first step lets that be changed
                      onClick: () =>
                        navigate(
                          row.assigned_client_user
                            ? `/msp/requests/new?client_user=${encodeURIComponent(row.assigned_client_user)}`
                            : '/msp/requests/new?new_user=1'
                        ),
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

      <ColumnsModal
        open={choosingColumns}
        mode="listing"
        catalogue={PORTAL_DEVICE_LIST}
        onClose={() => setChoosingColumns(false)}
        onConfirm={(choice) => setShown(choice.columns)}
      />

      <ColumnsModal
        open={picking}
        catalogue={PORTAL_DEVICES}
        onClose={() => setPicking(false)}
        onConfirm={(picks) =>
          portal.exportMyMachines(
            {
              customer: customer || undefined,
              search: search || undefined,
              status: (filters.status as string) || undefined,
              service: (filters.service as string) || undefined,
              coverage: (filters.coverage as string) || undefined,
            },
            picks
          )
        }
      />
    </div>
  );
}
