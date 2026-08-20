import { useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { useServiceRows, useSubscribedServices } from '../hooks/usePortal';
import { usePortalFilters } from '../store/usePortalFilters';
import type { SubscribedService } from '@/lib/api/portal';

const COLUMNS = ['User', 'Department', 'Device', 'Since', 'Last billed', 'Status', ''];

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
  'Pending Setup': 'bg-amber-100 text-amber-700',
  'Pending Removal': 'bg-orange-100 text-orange-700',
  Suspended: 'bg-orange-100 text-orange-700',
  Ended: 'bg-slate-100 text-slate-500',
  Cancelled: 'bg-slate-100 text-slate-500',
  Draft: 'bg-slate-100 text-slate-600',
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

function ServiceTable({ service }: { service: SubscribedService }) {
  const navigate = useNavigate();
  const { data, isLoading, error, filters } = useServiceRows(service.service_item);
  const nextServicePage = usePortalFilters((state) => state.nextServicePage);
  const previousServicePage = usePortalFilters((state) => state.previousServicePage);
  const setServicePageLength = usePortalFilters((state) => state.setServicePageLength);
  const setServiceSearch = usePortalFilters((state) => state.setServiceSearch);
  const setServiceStatus = usePortalFilters((state) => state.setServiceStatus);
  const rows = data?.rows ?? [];

  return (
    <DataTable
      title={service.item_name}
      columns={COLUMNS}
      rowCount={rows.length}
      isLoading={isLoading}
      error={error}
      emptyLabel="No subscription found for this service."
      searchPlaceholder="Search user, device…"
      statuses={SERVICE_STATUSES}
      start={filters.start}
      pageLength={filters.pageLength}
      total={data?.total ?? 0}
      onPrevious={() => previousServicePage(service.service_item)}
      onNext={() => nextServicePage(service.service_item)}
      onPageLengthChange={(size) => setServicePageLength(service.service_item, size)}
      search={filters.search}
      onSearchChange={(value) => setServiceSearch(service.service_item, value)}
      status={filters.status}
      onStatusChange={(value) => setServiceStatus(service.service_item, value)}
    >
      {rows.map((row) => (
        <tr
          key={row.name}
          onClick={() => row.client_user && navigate(`/msp/users/${row.client_user}`)}
          className={`transition-colors hover:bg-slate-50 ${row.client_user ? 'cursor-pointer' : ''}`}
        >
          <td className="whitespace-nowrap px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{row.user_name || 'N/A'}</p>
            {row.email && <p className="text-xs text-slate-400">{row.email}</p>}
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
            {row.department || 'N/A'}
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
            {row.hostname || 'N/A'}
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
            {fmtDate(row.effective_start_date)}
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
            {fmtDate(row.last_billed_on)}
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
          <td className="whitespace-nowrap px-4 py-3">
            <div className="flex justify-end">
              <RowActionsMenu
                actions={[
                  {
                    label: 'View profile',
                    icon: Eye,
                    onClick: () => navigate(`/msp/users/${row.client_user}`),
                    disabled: !row.client_user,
                  },
                ]}
              />
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

export default function PortalRecords() {
  const { data, isLoading } = useSubscribedServices();
  const services = data?.services ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (!services.length) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-slate-100 bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-slate-500">No service subscribed yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-6 pb-6 pt-4">
      {/* <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate('/msp/requests/new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <FilePlus2 size={15} />
          New request
        </button>
      </div> */}

      {services.map((service) => (
        <ServiceTable key={service.service_item} service={service} />
      ))}
    </div>
  );
}
