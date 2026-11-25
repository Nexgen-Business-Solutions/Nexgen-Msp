import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Eye,
  FilePlus2,
  Inbox,
  Laptop,
  Layers,
  PlugZap,
  PowerOff,
  Receipt,
  ReceiptText,
  UserPlus,
  Users,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import KpiDetailPanel from '@/shared/components/KpiDetailPanel';
import DataTable from '@/shared/components/DataTable';
import StatusBadge from '@/shared/components/StatusBadge';
import type { KpiName } from '@/lib/api/portal';
import {
  useKpiRows,
  usePortalSummary,
  useServiceRequests,
  useRecentActivity,
  useMyApprovalRights,
} from '../hooks/usePortal';

const KPI_DESCRIPTIONS: Record<KpiName, string> = {
  active_services: 'Every service currently running for your company.',
  open_requests: 'Requests still being processed by Nexgen.',
};

const REQUEST_COLUMNS = ['Request', 'Type', 'Priority', 'Status', 'Created', ''];
const ACTIVITY = {
  invoice: { icon: Receipt, surround: 'bg-emerald-50 ring-emerald-100', color: 'text-emerald-600' },
  credit_note: { icon: ReceiptText, surround: 'bg-violet-50 ring-violet-100', color: 'text-violet-600' },
  request: { icon: Inbox, surround: 'bg-blue-50 ring-blue-100', color: 'text-blue-600' },
  user: { icon: UserPlus, surround: 'bg-indigo-50 ring-indigo-100', color: 'text-indigo-600' },
  device: { icon: Laptop, surround: 'bg-slate-100 ring-slate-200', color: 'text-slate-600' },
  service_started: { icon: PlugZap, surround: 'bg-emerald-50 ring-emerald-100', color: 'text-emerald-600' },
  service_ended: { icon: PowerOff, surround: 'bg-amber-50 ring-amber-100', color: 'text-amber-600' },
} as const;

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-6">
    <div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{description}</p>
    </div>
    {children}
  </section>
);


const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

/** A draft is still being written: opening it means reopening the form. */
const requestHref = (row: { name: string; status: string }) =>
  row.status === 'Draft'
    ? `/msp/requests/new?draft=${encodeURIComponent(row.name)}`
    : `/msp/requests/${row.name}`;

export default function PortalDashboard() {
  const rights = useMyApprovalRights();
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
    <div className="space-y-6 px-6 pb-6 pt-5">
      <Section
        title="At a glance"
        description="What Nexgen runs for your company today."
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Layers}
            accent="emerald"
            label="Active services"
            value={summary.data?.active_services ?? 0}
            caption="Currently running service assignments"
            loading={summary.isLoading}
            onView={() => openKpi('active_services')}
          />
          <KpiCard
            icon={Inbox}
            accent="blue"
            label="Open requests"
            value={summary.data?.open_requests ?? 0}
            caption={`${summary.data?.awaiting_approval ?? 0} awaiting internal approval`}
            loading={summary.isLoading}
            onView={() => openKpi('open_requests')}
          />
          <KpiCard
            icon={Users}
            accent="indigo"
            label="Active users"
            value={summary.data?.active_client_users ?? 0}
            caption="Managed people currently active"
            loading={summary.isLoading}
          />
          <KpiCard
            icon={Laptop}
            accent="slate"
            label="Active devices"
            value={summary.data?.active_devices ?? 0}
            caption="Devices currently deployed"
            loading={summary.isLoading}
          />
        </div>
      </Section>

      <Section
        title="Your requests and activity"
        description="The latest requests your company raised, and what changed lately."
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="min-w-0 xl:col-span-3">
            <DataTable
              title="Latest requests"
              columns={REQUEST_COLUMNS}
              rowCount={requestRows.length}
              isLoading={requests.isLoading}
              error={requests.error}
              emptyLabel="No requests yet."
              showToolbar={false}
              showPagination={false}
              action={
                rights.data?.can_submit !== true
                  ? undefined
                  : { label: 'New Request', icon: FilePlus2, onClick: () => navigate('/msp/requests/new') }
              }
            >
              {requestRows.map((row) => (
                <tr
                  key={row.name}
                  onClick={() => navigate(requestHref(row))}
                  className="cursor-pointer transition-colors hover:bg-slate-50/80"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{row.request_type}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.priority} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-500">
                    {fmtDate(row.creation)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'View request',
                            icon: Eye,
                            onClick: () => navigate(requestHref(row)),
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>

          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 xl:col-span-2">
            <div className="px-5 pb-2 pt-5 sm:px-6">
              <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                What changed lately across your services, people and invoices.
              </p>
            </div>

            <div className="max-h-[32rem] flex-1 overflow-auto px-5 pb-5 sm:px-6">
              {activity.isLoading && (
                <ul className="space-y-1 py-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((index) => (
                    <li key={index} className="flex items-center gap-3 py-3">
                      <span className="size-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                      <span className="flex-1 space-y-1.5">
                        <span className="block h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                        <span className="block h-3 w-1/3 animate-pulse rounded bg-slate-100" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {activity.error instanceof Error && (
                <p className="my-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
                  {activity.error.message}
                </p>
              )}

              {!activity.isLoading && !activity.error && events.length === 0 && (
                <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                    <Activity className="size-[18px]" strokeWidth={1.75} />
                  </span>
                  <span>Nothing has happened yet.</span>
                </div>
              )}

              <ol className="divide-y divide-slate-100">
                {events.map((event, index) => {
                  const tone = ACTIVITY[event.kind] ?? ACTIVITY.request;
                  const Icon = tone.icon;

                  return (
                    <li key={`${event.kind}-${event.on}-${index}`}>
                      <button
                        type="button"
                        disabled={!event.link}
                        onClick={() => event.link && navigate(`/msp${event.link}`)}
                        className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-xl px-2 py-3 text-left transition-colors enabled:hover:bg-slate-50/80 disabled:cursor-default"
                      >
                        <span
                          className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ring-1 ${tone.surround}`}
                        >
                          <Icon className={`size-4 ${tone.color}`} strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {event.title}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{event.detail}</span>
                        </span>
                        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-slate-400">{fmtDate(event.on)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </Section>

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
