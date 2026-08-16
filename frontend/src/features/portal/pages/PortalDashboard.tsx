import { Laptop, Layers, Users } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import DataTable from '@/shared/components/DataTable';
import { usePortalSummary, useServiceRequests, useClientUsers } from '../hooks/usePortal';

const REQUEST_COLUMNS = ['Request', 'Type', 'Priority', 'Status', 'Created'];
const USER_COLUMNS = ['Full name', 'Department', 'Email', 'Status', 'Started'];

const statusBadge: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-blue-100 text-blue-700',
  'Commercial Review': 'bg-amber-100 text-amber-700',
  'Technical Review': 'bg-amber-100 text-amber-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  'In Progress': 'bg-indigo-100 text-indigo-700',
  Completed: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-slate-100 text-slate-500',
  Active: 'bg-emerald-100 text-emerald-700',
  Disabled: 'bg-red-100 text-red-700',
  Pending: 'bg-amber-100 text-amber-700',
  Archived: 'bg-slate-100 text-slate-500',
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

export default function PortalDashboard() {
  const summary = usePortalSummary();
  const requests = useServiceRequests(5);
  const users = useClientUsers(10);

  const requestRows = requests.data?.rows ?? [];
  const userRows = users.data?.rows ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          icon={Users}
          iconBg="bg-blue-50"
          iconClass="text-blue-600"
          label="Users"
          value={String(summary.data?.client_users ?? 'N/A')}
          caption={`${summary.data?.active_client_users ?? 0} active`}
        />
        <KpiCard
          icon={Laptop}
          iconBg="bg-sky-50"
          iconClass="text-sky-600"
          label="Devices"
          value={String(summary.data?.devices ?? 'N/A')}
          caption={`${summary.data?.active_devices ?? 0} active`}
        />
        <KpiCard
          icon={Layers}
          iconBg="bg-emerald-50"
          iconClass="text-emerald-600"
          label="Services"
          value={String(summary.data?.service_assignments ?? 'N/A')}
          caption={`${summary.data?.open_requests ?? 0} open requests`}
        />
      </div>

      <DataTable
        title="Latest requests"
        columns={REQUEST_COLUMNS}
        rowCount={requestRows.length}
        isLoading={requests.isLoading}
        error={requests.error}
        emptyLabel="No requests yet."
        showToolbar={false}
        showPagination={false}
      >
        {requestRows.map((row) => (
          <tr key={row.name} className="transition-colors hover:bg-slate-50">
            <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
              {row.name}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{row.request_type}</td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">{row.priority}</td>
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
              {fmtDate(row.creation)}
            </td>
          </tr>
        ))}
      </DataTable>

      <DataTable
        title="Users and services"
        columns={USER_COLUMNS}
        rowCount={userRows.length}
        isLoading={users.isLoading}
        error={users.error}
        emptyLabel="No users yet."
        showToolbar={false}
        showPagination={false}
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
    </div>
  );
}
