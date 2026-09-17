import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as internal from '@/lib/api/internal';
import {
  Eye,
  Laptop,
  Pencil,
  Plus,
  PowerOff,
  RotateCcw,
  ShieldAlert,
  UserX,
  Wifi,
} from 'lucide-react';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import ColumnsModal from '@/shared/components/ColumnsModal';
import { INTERNAL_DEVICES, loadChoice } from '@/shared/exportColumns';
import { INTERNAL_DEVICE_LIST } from '@/shared/listColumns';
import StatusBadge from '@/shared/components/StatusBadge';
import KpiCard from '@/shared/components/KpiCard';
import TablePagination from '@/shared/components/TablePagination';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import DeviceServiceModal from '../components/DeviceServiceModal';
import EditDeviceModal from '../components/EditDeviceModal';
import RetireDeviceModal from '../components/RetireDeviceModal';
import ReinstateDeviceModal from '../components/ReinstateDeviceModal';
import AddDeviceModal from '../components/AddDeviceModal';
import type { DeviceRow } from '@/lib/api/internal';
import {
  useDeviceFilterOptions,
  useDeviceFilters,
  useDeviceList,
  useDeviceStats,
} from '../hooks/useDevices';
import { canReinstate, canRetire } from '../utils/deviceStatus';

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const INTERFACE_ORDER = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const COVERAGE_OPTIONS = [
  { value: 'no_service', label: 'No active service', description: 'Active, nothing running on it' },
  { value: 'stock', label: 'In stock', description: 'Available, nobody holds it' },
  { value: 'no_mac', label: 'No MAC recorded', description: 'Identification incomplete' },
];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

export default function DevicesList() {
  const [picking, setPicking] = useState(false);
  const [choosingColumns, setChoosingColumns] = useState(false);
  // what this person chose to see, kept in their browser
  const [shown, setShown] = useState(() => loadChoice(INTERNAL_DEVICE_LIST).columns);
  const navigate = useNavigate();
  const { filters, patch, clear } = useDeviceFilters();
  const options = useDeviceFilterOptions();
  // the cards describe the whole population; a filter narrows the list below, never them
  const stats = useDeviceStats();
  // what the list (and its export) is narrowed to
  const listParams = {
    search: filters.search || undefined,
    customer: filters.customer || undefined,
    status: filters.status || undefined,
    device_type: filters.device_type || undefined,
    coverage: filters.coverage || undefined,
  };
  const list = useDeviceList(filters);

  const [serviceDevice, setServiceDevice] = useState<string | null>(null);
  const [editDevice, setEditDevice] = useState<DeviceRow | null>(null);
  const [newDeviceOpen, setNewDeviceOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    row: DeviceRow;
    action: 'Retire' | 'Reinstate';
  } | null>(null);

  const rows = list.data?.rows ?? [];
  const labels = Object.fromEntries(INTERNAL_DEVICE_LIST.columns.map((column) => [column.key, column.label]));
  const span = shown.length + 1;

  const cell = (key: string, row: DeviceRow) => {
    switch (key) {
      case 'device':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <button
              type="button"
              onClick={() => navigate(`/msp/devices/${row.name}`)}
              className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
            >
              {row.hostname}
            </button>
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
                {row.user_name}
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
            {fmtDate(row[key])}
          </td>
        );
      default: {
        const value = row[key as 'customer' | 'device_type' | 'user_department' | 'manufacturer' | 'model' | 'operating_system' | 'services'];

        return (
          <td key={key} className="px-4 py-3 text-sm text-slate-600">
            {value || <span className="text-slate-400">N/A</span>}
          </td>
        );
      }
    }
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Laptop}
          accent="blue"
          label="Active devices"
          value={stats.data?.active_devices ?? 0}
          caption="Machines currently in service"
          loading={stats.isLoading}
          onView={() => patch({ status: 'Active', coverage: '' })}
        />
        <KpiCard
          icon={ShieldAlert}
          tone="alert"
          accent="slate"
          label="No service"
          value={stats.data?.devices_without_services ?? 0}
          caption="Active devices with no active service"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'no_service', status: '' })}
        />
        <KpiCard
          icon={UserX}
          accent="indigo"
          label="Devices in stock"
          value={stats.data?.devices_in_stock ?? 0}
          caption="Available, nobody holds them"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'stock', status: '' })}
        />
        <KpiCard
          icon={Wifi}
          tone="alert"
          accent="slate"
          label="No MAC recorded"
          value={stats.data?.devices_without_mac ?? 0}
          caption="Identification still incomplete"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'no_mac', status: '' })}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setNewDeviceOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus size={15} />
          New device
        </button>
      </div>

      <FilterBar
        values={filters as unknown as FilterState}
        search={filters.search}
        searchPlaceholder="Search hostname, holder, username, serial or MAC…"
        subtitle="Narrow the device register."
        onSearch={(value) => patch({ search: value })}
        onApply={(values) =>
          patch({
            customer: (values.customer as string) ?? '',
            status: (values.status as string) ?? '',
            device_type: (values.device_type as string) ?? '',
            coverage: (values.coverage as string) ?? '',
          })
        }
        onClear={clear}
        onRefresh={() => list.refetch()}
        onExport={() => setPicking(true)}
        onColumns={() => setChoosingColumns(true)}
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
            key: 'device_type',
            label: 'Type',
            kind: 'select',
            allLabel: 'All types',
            options: (options.data?.device_types ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'coverage',
            label: 'Coverage',
            kind: 'select',
            allLabel: 'Any coverage',
            options: COVERAGE_OPTIONS,
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white pt-4 shadow-sm">
        <div className="max-h-[62vh] overflow-auto px-5 pb-1">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {[...shown, ''].map((key, index) => (
                  <th
                    key={key || 'actions'}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === shown.length ? 'rounded-r-lg' : ''}`}
                  >
                    {labels[key] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!!list.error && (
                <tr>
                  <td colSpan={span} className="px-4 py-12 text-center text-sm text-red-600">
                    {(list.error as Error)?.message || 'Failed to load devices.'}
                  </td>
                </tr>
              )}

              {!list.error && list.isLoading && (
                <tr>
                  <td colSpan={span} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!list.error && !list.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={span} className="px-4 py-12 text-center text-sm text-slate-500">
                    No device matches these filters.
                  </td>
                </tr>
              )}

              {!list.error &&
                !list.isLoading &&
                rows.map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50">
                    {shown.map((key) => cell(key, row))}
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={
                            [
                              {
                                label: 'View device',
                                icon: Eye,
                                onClick: () => navigate(`/msp/devices/${row.name}`),
                              },
                              {
                                label: 'Add service',
                                icon: Plus,
                                onClick: () => setServiceDevice(row.name),
                                disabled: row.status !== 'Active',
                              },
                              { label: 'Edit device', icon: Pencil, onClick: () => setEditDevice(row) },
                              {
                                label: 'Put back in service',
                                icon: RotateCcw,
                                onClick: () => setStatusTarget({ row, action: 'Reinstate' }),
                                disabled: !canReinstate(row.status),
                              },
                              {
                                label: 'Retire device',
                                icon: PowerOff,
                                onClick: () => setStatusTarget({ row, action: 'Retire' }),
                                danger: true,
                                disabled: !canRetire(row.status),
                              },
                            ] as RowAction[]
                          }
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
          onPrevious={() => patch({ start: Math.max(filters.start - filters.pageLength, 0) })}
          onNext={() => patch({ start: filters.start + filters.pageLength })}
          onPageLengthChange={(size) => patch({ pageLength: size, start: 0 })}
        />
      </div>

      <DeviceServiceModal device={serviceDevice} onClose={() => setServiceDevice(null)} />

      <EditDeviceModal device={editDevice} onClose={() => setEditDevice(null)} />

      {/* the same form as on a person and on a request, with the customer picked first */}
      <AddDeviceModal
        open={newDeviceOpen}
        deviceTypes={options.data?.device_types ?? []}
        interfaceTypes={options.data?.interface_types ?? []}
        requests={[]}
        onClose={() => setNewDeviceOpen(false)}
      />

      {/* the same act asks the same questions here as on the machine's own page */}
      <RetireDeviceModal
        open={statusTarget?.action === 'Retire'}
        device={statusTarget?.row.name ?? ''}
        hostname={statusTarget?.row.hostname ?? ''}
        serialNumber={statusTarget?.row.serial_number}
        currentHolder={statusTarget?.row.assigned_client_user}
        currentHolderName={statusTarget?.row.user_name}
        openServiceCount={statusTarget?.row.active_services ?? 0}
        onClose={() => setStatusTarget(null)}
      />

      <ReinstateDeviceModal
        open={statusTarget?.action === 'Reinstate'}
        device={statusTarget?.row.name ?? ''}
        hostname={statusTarget?.row.hostname ?? ''}
        serialNumber={statusTarget?.row.serial_number}
        customer={statusTarget?.row.customer ?? ''}
        onClose={() => setStatusTarget(null)}
      />

      <ColumnsModal
        open={choosingColumns}
        mode="listing"
        catalogue={INTERNAL_DEVICE_LIST}
        onClose={() => setChoosingColumns(false)}
        onConfirm={(choice) => setShown(choice.columns)}
      />

      <ColumnsModal
        open={picking}
        catalogue={INTERNAL_DEVICES}
        onClose={() => setPicking(false)}
        onConfirm={(picks) => internal.exportDevices(listParams, picks)}
      />
    </div>
  );
}
