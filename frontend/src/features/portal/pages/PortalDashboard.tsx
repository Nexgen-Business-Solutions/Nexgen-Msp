import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  FilePlus2,
  Inbox,
  Laptop,
  Layers,
  PlugZap,
  PowerOff,
  Receipt,
  ReceiptText,
  ShieldAlert,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiDetailPanel from '@/shared/components/KpiDetailPanel';
import DataTable from '@/shared/components/DataTable';
import type { KpiName } from '@/lib/api/portal';
import {
  useKpiRows,
  usePortalSummary,
  useServiceRequests,
  useRecentActivity,
} from '../hooks/usePortal';

const KPI_DESCRIPTIONS: Record<KpiName, string> = {
  active_services: 'Every service currently running for your company.',
  open_requests: 'Requests still being processed by Nexgen.',
  reclaimable_licences: 'Services still running for users who have left — cancel them to stop being billed.',
  unprotected_devices: 'Active devices with no endpoint protection.',
};

const REQUEST_COLUMNS = ['Request', 'Type', 'Priority', 'Status', 'Created', ''];
const ACTIVITY = {
  invoice: { icon: Receipt, surround: 'bg-emerald-50', color: 'text-emerald-600' },
  credit_note: { icon: ReceiptText, surround: 'bg-rose-50', color: 'text-rose-600' },
  request: { icon: Inbox, surround: 'bg-blue-50', color: 'text-blue-600' },
  user: { icon: UserPlus, surround: 'bg-indigo-50', color: 'text-indigo-600' },
  device: { icon: Laptop, surround: 'bg-slate-100', color: 'text-slate-600' },
  service_started: { icon: PlugZap, surround: 'bg-emerald-50', color: 'text-emerald-600' },
  service_ended: { icon: PowerOff, surround: 'bg-amber-50', color: 'text-amber-600' },
} as const;

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
  const activity = useRecentActivity();
  const events = activity.data?.rows ?? [];

  const [kpi, setKpi] = useState<KpiName | null>(null);
  const [kpiStart, setKpiStart] = useState(0);
  const [kpiPageLength, setKpiPageLength] = useState(20);
  const kpiRows = useKpiRows(kpi, kpiStart, kpiPageLength);

  const openKpi = (name: KpiName) => {
    setKpi(name);
    setKpiStart(0);
  };

  const requestRows = requests.data?.rows ?? [];

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

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            What changed lately across your services, people and invoices.
          </p>
        </div>

        <div className="px-5 pb-5">
          {activity.isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}

          {activity.error instanceof Error && (
            <p className="py-8 text-center text-sm text-red-600">{activity.error.message}</p>
          )}

          {!activity.isLoading && !activity.error && events.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">Nothing has happened yet.</p>
          )}

          <ol className="space-y-1">
            {events.map((event, index) => {
              const tone = ACTIVITY[event.kind] ?? ACTIVITY.request;
              const Icon = tone.icon;

              return (
                <li key={`${event.kind}-${event.on}-${index}`}>
                  <button
                    type="button"
                    disabled={!event.link}
                    onClick={() => event.link && navigate(`/msp${event.link}`)}
                    className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors enabled:hover:bg-slate-50 disabled:cursor-default"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.surround}`}
                    >
                      <Icon size={15} className={tone.color} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {event.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{event.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{fmtDate(event.on)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

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
