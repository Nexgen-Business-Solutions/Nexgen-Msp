import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Laptop,
  Pencil,
  Plus,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  UserX,
  Wifi,
  X,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import Modal from '@/shared/components/Modal';
import Select from '@/shared/components/Select';
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
  type DeviceFilterState,
} from '../hooks/useDevices';

const COLUMNS = ['Device', 'Customer', 'Type', 'Network interfaces', 'Active services', 'Inactive services', ''];

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const INTERFACE_ORDER = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const COVERAGE_LABELS: Record<string, string> = {
  no_security: 'No endpoint protection',
  unassigned: 'Not assigned to anyone',
  no_mac: 'No MAC recorded',
};

const COVERAGE_OPTIONS = [
  { value: '', label: 'Any coverage' },
  { value: 'no_security', label: 'No endpoint protection', description: 'Active, unprotected' },
  { value: 'unassigned', label: 'Not assigned to anyone', description: 'Active, no holder' },
  { value: 'no_mac', label: 'No MAC recorded', description: 'Identification incomplete' },
];

const toOptions = (values: string[] = [], allLabel: string) => [
  { value: '', label: allLabel },
  ...values.map((value) => ({ value, label: value })),
];

export default function DevicesList() {
  const navigate = useNavigate();
  const { filters, patch, clear, activeCount } = useDeviceFilters();
  const options = useDeviceFilterOptions();
  const stats = useDeviceStats();
  const list = useDeviceList(filters);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState<DeviceFilterState>(filters);
  const [serviceDevice, setServiceDevice] = useState<string | null>(null);
  const [editDevice, setEditDevice] = useState<DeviceRow | null>(null);
  const [newDeviceOpen, setNewDeviceOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    row: DeviceRow;
    action: 'Retire' | 'Reinstate';
  } | null>(null);
  const changeStatus = useChangeDeviceStatus();

  const rows = list.data?.rows ?? [];

  const openFilters = () => {
    setDraft(filters);
    setFiltersOpen(true);
  };

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.customer)
    chips.push({
      key: 'customer',
      label: `Customer: ${filters.customer}`,
      onRemove: () => patch({ customer: '' }),
    });
  if (filters.status)
    chips.push({
      key: 'status',
      label: `Status: ${filters.status}`,
      onRemove: () => patch({ status: '' }),
    });
  if (filters.device_type)
    chips.push({
      key: 'type',
      label: `Type: ${filters.device_type}`,
      onRemove: () => patch({ device_type: '' }),
    });
  if (filters.coverage)
    chips.push({
      key: 'coverage',
      label: COVERAGE_LABELS[filters.coverage] ?? filters.coverage,
      onRemove: () => patch({ coverage: '' }),
    });

  const ghost =
    'flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50';

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

      <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(event) => patch({ search: event.target.value })}
              placeholder="Search hostname, holder, serial or MAC…"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <button type="button" onClick={openFilters} className={ghost}>
            <SlidersHorizontal size={16} />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-semibold text-blue-700">
                {activeCount}
              </span>
            )}
          </button>

          <button type="button" onClick={() => list.refetch()} className={ghost}>
            <RefreshCw size={16} />
            <span className="hidden lg:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setNewDeviceOpen(true)}
            className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={16} />
            New device
          </button>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 py-1 pl-3 pr-2 text-xs font-medium text-blue-700"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`Remove ${chip.label}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clear}
              className="ml-1 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

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
                      <p className="text-sm font-semibold text-slate-900">{row.hostname}</p>
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

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        icon={SlidersHorizontal}
        tone="slate"
        title="Filters"
        subtitle="Narrow the device register."
        widthClass="max-w-3xl"
        footer={
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  customer: '',
                  status: '',
                  device_type: '',
                  coverage: '',
                }))
              }
              className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => {
                patch({
                  customer: draft.customer,
                  status: draft.status,
                  device_type: draft.device_type,
                  coverage: draft.coverage,
                });
                setFiltersOpen(false);
              }}
              className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Customer"
            value={draft.customer}
            onChange={(value) => setDraft((current) => ({ ...current, customer: value }))}
            options={toOptions(options.data?.customers, 'All customers')}
            className="min-w-0"
          />
          <Select
            label="Status"
            value={draft.status}
            onChange={(value) => setDraft((current) => ({ ...current, status: value }))}
            options={toOptions(options.data?.statuses, 'All statuses')}
            className="min-w-0"
          />
          <Select
            label="Type"
            value={draft.device_type}
            onChange={(value) => setDraft((current) => ({ ...current, device_type: value }))}
            options={toOptions(options.data?.device_types, 'All types')}
            className="min-w-0"
          />
          <Select
            label="Coverage"
            value={draft.coverage}
            onChange={(value) => setDraft((current) => ({ ...current, coverage: value }))}
            options={COVERAGE_OPTIONS}
            className="min-w-0"
          />
        </div>
      </Modal>
    </div>
  );
}
