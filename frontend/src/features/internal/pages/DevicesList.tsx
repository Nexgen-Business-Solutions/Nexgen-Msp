import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import KpiCard from '@/shared/components/KpiCard';
import TablePagination from '@/shared/components/TablePagination';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import ConfirmModal from '@/shared/components/ConfirmModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import EditDeviceModal from '../components/EditDeviceModal';
import NewDeviceModal from '../components/NewDeviceModal';
import type { DeviceRow } from '@/lib/api/internal';
import {
  useDeviceFilterOptions,
  useDeviceFilters,
  useDeviceList,
  useDeviceStats,
  useChangeDeviceStatus,
} from '../hooks/useDevices';

const COLUMNS = ['Device', 'Customer', 'Type', 'Network interfaces', 'Active services', 'Inactive services', ''];

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const INTERFACE_ORDER = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const COVERAGE_OPTIONS = [
  { value: 'no_security', label: 'No endpoint protection', description: 'Active, unprotected' },
  { value: 'unassigned', label: 'Not assigned to anyone', description: 'Active, no holder' },
  { value: 'no_mac', label: 'No MAC recorded', description: 'Identification incomplete' },
];

export default function DevicesList() {
  const navigate = useNavigate();
  const { filters, patch, clear } = useDeviceFilters();
  const options = useDeviceFilterOptions();
  const stats = useDeviceStats();
  const list = useDeviceList(filters);

  const [serviceDevice, setServiceDevice] = useState<string | null>(null);
  const [editDevice, setEditDevice] = useState<DeviceRow | null>(null);
  const [newDeviceOpen, setNewDeviceOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    row: DeviceRow;
    action: 'Retire' | 'Reinstate';
  } | null>(null);
  const changeStatus = useChangeDeviceStatus();

  const rows = list.data?.rows ?? [];

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
          label="Unprotected"
          value={stats.data?.unprotected_devices ?? 0}
          caption="Active devices with no security service"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'no_security', status: '' })}
        />
        <KpiCard
          icon={UserX}
          accent="indigo"
          label="Unassigned"
          value={stats.data?.unassigned_devices ?? 0}
          caption="Active devices with no holder"
          loading={stats.isLoading}
          onView={() => patch({ coverage: 'unassigned', status: '' })}
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

      <FilterBar
        values={filters as unknown as FilterState}
        search={filters.search}
        searchPlaceholder="Search hostname, holder, serial or MAC…"
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

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="overflow-x-auto px-5 pb-1 pt-4">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column || index}
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
                    {(list.error as Error)?.message || 'Failed to load devices.'}
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
                    No device matches these filters.
                  </td>
                </tr>
              )}

              {!list.error &&
                !list.isLoading &&
                rows.map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/msp/devices/${row.name}`)}
                        className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
                      >
                        {row.hostname}
                      </button><br />
                      {row.assigned_client_user ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/msp/users/${row.assigned_client_user}`)}
                          className="text-xs text-blue-600 transition-colors hover:text-blue-800 hover:underline"
                        >
                          {row.user_name}
                        </button>
                      ) : (
                        <p className="text-xs text-slate-400">Unassigned</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.customer}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.device_type}
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
                      {!row.protected && row.status === 'Active' && (
                        <span className="ml-1.5 text-xs font-medium text-amber-600">
                          unprotected
                        </span>
                      )}
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
                      {row.status !== 'Active' && (
                        <span className="ml-1.5 text-xs font-medium text-slate-400">
                          {row.status.toLowerCase()}
                        </span>
                      )}
                    </td>
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
                                disabled: row.status === 'Active',
                              },
                              {
                                label: 'Retire device',
                                icon: PowerOff,
                                onClick: () => setStatusTarget({ row, action: 'Retire' }),
                                danger: true,
                                disabled: row.status !== 'Active',
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

      <NewDeviceModal open={newDeviceOpen} onClose={() => setNewDeviceOpen(false)} />

      <ConfirmModal
        open={Boolean(statusTarget)}
        tone={statusTarget?.action === 'Retire' ? 'danger' : 'info'}
        title={
          statusTarget?.action === 'Retire'
            ? `Retire ${statusTarget.row.hostname}?`
            : `Put ${statusTarget?.row.hostname} back in service?`
        }
        description={
          statusTarget?.action === 'Retire'
            ? statusTarget.row.active_services > 0
              ? `Its ${statusTarget.row.active_services} active service(s) will be closed on the same day, so nothing keeps being billed.`
              : 'The machine leaves the active fleet. Its history is kept.'
            : 'The machine returns to the active fleet. Its services stay closed until you add them again.'
        }
        confirmLabel={statusTarget?.action === 'Retire' ? 'Retire' : 'Put back in service'}
        loading={changeStatus.isLoading}
        onCancel={() => setStatusTarget(null)}
        onConfirm={async () => {
          if (!statusTarget) return;
          try {
            await changeStatus.mutateAsync({
              device: statusTarget.row.name,
              action: statusTarget.action,
            });
            setStatusTarget(null);
          } catch {
            // the list surfaces nothing here; keep the dialog open on failure
          }
        }}
      />

      {changeStatus.error instanceof Error && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
          {changeStatus.error.message}
        </div>
      )}

    </div>
  );
}
