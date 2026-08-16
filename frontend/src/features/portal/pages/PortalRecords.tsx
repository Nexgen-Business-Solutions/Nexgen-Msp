import DataTable from '@/shared/components/DataTable';
import { useClientUsers, useDevices, useServiceAssignments } from '../hooks/usePortal';

const USER_COLUMNS = ['Full name', 'Department', 'Email', 'Status', 'Started'];
const DEVICE_COLUMNS = ['Hostname', 'Type', 'Assigned to', 'Status', 'Assigned on'];
const SERVICE_COLUMNS = ['Service', 'Scope', 'Target', 'Quantity', 'Status', 'Since'];

const USER_STATUSES = ['Pending', 'Active', 'Disabled', 'Archived'];
const DEVICE_STATUSES = ['Pending', 'Active', 'Stock', 'Returned', 'Damaged', 'Retired', 'Lost'];
const SERVICE_STATUSES = [
  'Draft',
  'Pending Setup',
  'Active',
  'Suspended',
  'Pending Removal',
  'Ended',
  'Cancelled',
];

const statusBadge: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  Pending: 'bg-amber-100 text-amber-700',
  'Pending Setup': 'bg-amber-100 text-amber-700',
  'Pending Removal': 'bg-orange-100 text-orange-700',
  Suspended: 'bg-orange-100 text-orange-700',
  Disabled: 'bg-red-100 text-red-700',
  Lost: 'bg-red-100 text-red-700',
  Damaged: 'bg-red-100 text-red-700',
  Ended: 'bg-slate-100 text-slate-500',
  Archived: 'bg-slate-100 text-slate-500',
  Retired: 'bg-slate-100 text-slate-500',
  Returned: 'bg-slate-100 text-slate-500',
  Cancelled: 'bg-slate-100 text-slate-500',
  Stock: 'bg-blue-100 text-blue-700',
  Draft: 'bg-slate-100 text-slate-600',
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const pagerProps = (start: number, pageLength: number, total: number) => {
  const page = Math.floor(start / pageLength) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageLength));

  return {
    page,
    totalPages,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageLength, total),
    total,
  };
};

export default function PortalRecords() {
  const users = useClientUsers();
  const devices = useDevices();
  const services = useServiceAssignments();

  const userRows = users.data?.rows ?? [];
  const deviceRows = devices.data?.rows ?? [];
  const serviceRows = services.data?.rows ?? [];

  return (
    <div className="space-y-6 p-6">
      <DataTable
        title="Users"
        columns={USER_COLUMNS}
        rowCount={userRows.length}
        isLoading={users.isLoading}
        error={users.error}
        emptyLabel="No users found."
        searchPlaceholder="Search name, email…"
        statuses={USER_STATUSES}
        {...pagerProps(users.filters.start, users.filters.pageLength, users.data?.total ?? 0)}
      >
        {userRows.map((row) => (
          <tr key={row.name} className="transition-colors hover:bg-slate-50">
            <td className="whitespace-nowrap px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{row.full_name}</p>
              <p className="text-xs text-slate-400">{row.name}</p>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
              {row.department || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.email || 'N/A'}
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  statusBadge[row.lifecycle_status] || 'bg-slate-100 text-slate-600'
                }`}
              >
                {String(row.lifecycle_status).toUpperCase()}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {fmtDate(row.start_date)}
            </td>
          </tr>
        ))}
      </DataTable>

      <DataTable
        title="Devices"
        columns={DEVICE_COLUMNS}
        rowCount={deviceRows.length}
        isLoading={devices.isLoading}
        error={devices.error}
        emptyLabel="No devices found."
        searchPlaceholder="Search hostname, serial…"
        statuses={DEVICE_STATUSES}
        {...pagerProps(devices.filters.start, devices.filters.pageLength, devices.data?.total ?? 0)}
      >
        {deviceRows.map((row) => (
          <tr key={row.name} className="transition-colors hover:bg-slate-50">
            <td className="whitespace-nowrap px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{row.hostname}</p>
              <p className="text-xs text-slate-400">{row.serial_number || row.name}</p>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{row.device_type}</td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.assigned_client_user || 'N/A'}
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  statusBadge[row.status] || 'bg-slate-100 text-slate-600'
                }`}
              >
                {String(row.status).toUpperCase()}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {fmtDate(row.assigned_date)}
            </td>
          </tr>
        ))}
      </DataTable>

      <DataTable
        title="Services"
        columns={SERVICE_COLUMNS}
        rowCount={serviceRows.length}
        isLoading={services.isLoading}
        error={services.error}
        emptyLabel="No services found."
        searchPlaceholder="Search service…"
        statuses={SERVICE_STATUSES}
        {...pagerProps(services.filters.start, services.filters.pageLength, services.data?.total ?? 0)}
      >
        {serviceRows.map((row) => (
          <tr key={row.name} className="transition-colors hover:bg-slate-50">
            <td className="whitespace-nowrap px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{row.service_item}</p>
              <p className="text-xs text-slate-400">{row.name}</p>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
              {row.assignment_scope}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {row.client_user || row.managed_device || row.customer_site || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700 tabular-nums">
              {row.quantity} {row.uom}
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  statusBadge[row.operational_status] || 'bg-slate-100 text-slate-600'
                }`}
              >
                {String(row.operational_status).toUpperCase()}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
              {fmtDate(row.effective_start_date)}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
