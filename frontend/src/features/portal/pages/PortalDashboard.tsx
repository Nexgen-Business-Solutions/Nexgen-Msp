import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, FilePlus2, Inbox, Layers, ShieldAlert, UserMinus } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiDetailPanel from '@/shared/components/KpiDetailPanel';
import DataTable from '@/shared/components/DataTable';
import type { KpiName } from '@/lib/api/portal';
import {
  useKpiRows,
  usePortalSummary,
  useServiceRequests,
  useUsersWithServices,
} from '../hooks/usePortal';
import { usePortalFilters } from '../store/usePortalFilters';

const KPI_DESCRIPTIONS: Record<KpiName, string> = {
  active_services: 'Every service currently running for your company.',
  open_requests: 'Requests still being processed by Nexgen.',
  reclaimable_licences: 'Services still running for users who have left — cancel them to stop being billed.',
  unprotected_devices: 'Active devices with no endpoint protection.',
};

const REQUEST_COLUMNS = ['Request', 'Type', 'Priority', 'Status', 'Created', ''];
const USER_COLUMNS = ['User', 'Department', 'Device', 'Services', 'Status', ''];

const statusBadge: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-blue-100 text-blue-700',
  'Under Review': 'bg-indigo-100 text-indigo-700',
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
  const navigate = useNavigate();
  const summary = usePortalSummary();
  const requests = useServiceRequests(5);
  const nextPage = usePortalFilters((state) => state.nextPage);
  const previousPage = usePortalFilters((state) => state.previousPage);
  const setPageLength = usePortalFilters((state) => state.setPageLength);
  const users = useUsersWithServices();

  const [kpi, setKpi] = useState<KpiName | null>(null);
  const [kpiStart, setKpiStart] = useState(0);
  const [kpiPageLength, setKpiPageLength] = useState(20);
  const kpiRows = useKpiRows(kpi, kpiStart, kpiPageLength);

  const openKpi = (name: KpiName) => {
    setKpi(name);
    setKpiStart(0);
  };

  const requestRows = requests.data?.rows ?? [];
  const userRows = users.data?.rows ?? [];

  return (
    <div className="space-y-6 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Layers}
          accent="emerald"
          label="Active services"
          value={summary.data?.active_services ?? 0}
          caption={`${summary.data?.catalogue_size ?? 0} services in catalogue`}
          loading={summary.isLoading}
          onView={() => openKpi('active_services')}
        />
        <KpiCard
          icon={Inbox}
          accent="blue"
          label="Open requests"
          value={summary.data?.open_requests ?? 0}
          caption={`${summary.data?.awaiting_approval ?? 0} awaiting approval`}
          loading={summary.isLoading}
          onView={() => openKpi('open_requests')}
        />
        <KpiCard
          icon={UserMinus}
          tone="alert"
          accent="slate"
          label="Licences to reclaim"
          value={summary.data?.reclaimable_licences ?? 0}
          caption="Disabled users with active services"
          loading={summary.isLoading}
          onView={() => openKpi('reclaimable_licences')}
        />
        <KpiCard
          icon={ShieldAlert}
          tone="alert"
          accent="slate"
          label="Unprotected devices"
          value={summary.data?.unprotected_devices ?? 0}
          caption="Active devices without security"
          loading={summary.isLoading}
          onView={() => openKpi('unprotected_devices')}
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
        action={{
          label: 'New Request',
          icon: FilePlus2,
          onClick: () => navigate('/msp/requests/new'),
        }}
      >
        {requestRows.map((row) => (
          <tr
            key={row.name}
            onClick={() => navigate(`/msp/requests/${row.name}`)}
            className="cursor-pointer transition-colors hover:bg-slate-50"
          >
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
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'View request',
                      icon: Eye,
                      onClick: () => navigate(`/msp/requests/${row.name}`),
                    },
                  ]}
                />
              </div>
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
        start={users.filters.start}
        pageLength={users.filters.pageLength}
        total={users.data?.total ?? 0}
        onPrevious={() => previousPage('clientUsers')}
        onNext={() => nextPage('clientUsers')}
        onPageLengthChange={(size) => setPageLength('clientUsers', size)}
      >
        {userRows.map((row) => (
          <tr
            key={row.name}
            onClick={() => navigate(`/msp/users/${row.name}`)}
            className="cursor-pointer transition-colors hover:bg-slate-50"
          >
            <td className="whitespace-nowrap px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{row.full_name}</p>
              {row.email && <p className="text-xs text-slate-400">{row.email}</p>}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
              {row.department || 'N/A'}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <p className="text-sm text-slate-700">{row.device_type || 'N/A'}</p>
              {row.hostname && <p className="text-xs text-slate-400">{row.hostname}</p>}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                {row.service_count}
              </span>
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
            <td className="whitespace-nowrap px-4 py-3">
              <div className="flex justify-end">
                <RowActionsMenu
                  actions={[
                    {
                      label: 'View profile',
                      icon: Eye,
                      onClick: () => navigate(`/msp/users/${row.name}`),
                    },
                  ]}
                />
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      <KpiDetailPanel
        open={Boolean(kpi)}
        title={kpiRows.data?.title ?? ''}
        description={kpi ? KPI_DESCRIPTIONS[kpi] : undefined}
        columns={kpiRows.data?.columns ?? []}
        rows={kpiRows.data?.rows ?? []}
        isLoading={kpiRows.isLoading}
        error={kpiRows.error}
        start={kpiStart}
        pageLength={kpiPageLength}
        total={kpiRows.data?.total ?? 0}
        onPrevious={() => setKpiStart((current) => Math.max(current - kpiPageLength, 0))}
        onNext={() => setKpiStart((current) => current + kpiPageLength)}
        onPageLengthChange={(size) => {
          setKpiPageLength(size);
          setKpiStart(0);
        }}
        onClose={() => setKpi(null)}
      />
    </div>
  );
}
