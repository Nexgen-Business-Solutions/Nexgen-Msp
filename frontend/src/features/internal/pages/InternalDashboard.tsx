import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Clock,
  Eye,
  Inbox,
  Laptop,
  Layers,
  ShieldAlert,
  UserMinus,
  Users,
  Wrench,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import KpiDetailPanel from '@/shared/components/KpiDetailPanel';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import type { InternalKpiName } from '@/lib/api/internal';
import StatusBadge from '@/shared/components/StatusBadge';
import { useDashboardKpiRows, useInternalDashboard } from '../hooks/useRequests';

const fmtAge = (hours: number) => {
  if (hours === null || hours === undefined) return 'N/A';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-4">
    <div>
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-400">{description}</p>
    </div>
    {children}
  </section>
);

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
    <div className="px-5 py-4">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
    </div>
    <div className="max-h-[26rem] overflow-auto px-5 pb-4">{children}</div>
  </div>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:rounded-l-lg last:rounded-r-lg">
    {children}
  </th>
);

export default function InternalDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useInternalDashboard();

  const [kpi, setKpi] = useState<InternalKpiName | null>(null);
  const [kpiStart, setKpiStart] = useState(0);
  const [kpiPageLength, setKpiPageLength] = useState(20);
  const kpiRows = useDashboardKpiRows(kpi, kpiStart, kpiPageLength);

  const openKpi = (name: InternalKpiName) => {
    setKpi(name);
    setKpiStart(0);
  };

  if (error) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(error as Error)?.message || 'Failed to load the dashboard.'}
        </div>
      </div>
    );
  }

  const requests = data?.requests;
  const portfolio = data?.portfolio;

  return (
    <div className="space-y-8 px-6 pb-6 pt-4">
      <Section
        title="Request queue"
        description="What is waiting on Nexgen right now, most urgent first."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Inbox}
            accent="blue"
            label="Open requests"
            value={requests?.open ?? 0}
            caption={`${requests?.awaiting_review ?? 0} not picked up yet`}
            loading={isLoading}
            onView={() => navigate('/msp/requests?scope=open')}
          />
          <KpiCard
            icon={Wrench}
            accent="indigo"
            label="Under review"
            value={requests?.under_review ?? 0}
            caption={`${requests?.in_progress ?? 0} in progress`}
            loading={isLoading}
            onView={() => navigate('/msp/requests?scope=all&status=Under+Review')}
          />
          <KpiCard
            icon={Layers}
            accent="emerald"
            label="Lines to execute"
            value={requests?.lines_to_execute ?? 0}
            caption="Approved work with no assignment yet"
            loading={isLoading}
            onView={() => navigate('/msp/requests?scope=all&status=Approved')}
          />
          <KpiCard
            icon={Clock}
            tone="alert"
            accent="slate"
            label="Ageing over 48h"
            value={requests?.ageing_open ?? 0}
            caption={`${requests?.urgent_open ?? 0} urgent or high priority`}
            loading={isLoading}
            onView={() => navigate('/msp/requests?scope=open')}
          />
        </div>

        <Panel title="Needs attention">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                <Th>Request</Th>
                <Th>Users</Th>
                <Th>Customer</Th>
                <Th>Priority</Th>
                <Th>Age</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && (data?.queue.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nothing waiting. The queue is clear.
                  </td>
                </tr>
              )}
              {data?.queue.map((row) => (
                <tr
                  key={row.name}
                  onClick={() => navigate(`/msp/requests/${row.name}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.name}
                  </td>
                  <td className="max-w-[15rem] px-4 py-3">
                    <p className="truncate text-sm text-slate-700" title={row.users ?? ''}>
                      {row.users || 'N/A'}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.customer}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.priority} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500 tabular-nums">
                    {fmtAge(row.age_hours)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.status} />
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
            </tbody>
          </table>
        </Panel>

        <Panel title="Work to execute">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                <Th>Request</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Service</Th>
                <Th>Device</Th>
                <Th>Due</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && (data?.pending_lines.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No approved line waiting for execution.
                  </td>
                </tr>
              )}
              {data?.pending_lines.map((row) => (
                <tr
                  key={`${row.request}-${row.idx}`}
                  onClick={() => navigate(`/msp/requests/${row.request}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.request}
                    <span className="ml-1 text-xs font-normal text-slate-400">#{row.idx}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                    {row.user_name || 'N/A'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.action} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.service}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.hostname || 'N/A'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(row.requested_effective_date)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'View request',
                            icon: Eye,
                            onClick: () => navigate(`/msp/requests/${row.request}`),
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>

      <Section
        title="Service health"
        description="Coverage gaps and licences that are still being billed for nothing."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <KpiCard
            icon={UserMinus}
            tone="alert"
            accent="slate"
            label="Licences to reclaim"
            value={data?.hygiene.reclaimable_licences ?? 0}
            caption="Services still open on disabled users"
            loading={isLoading}
            onView={() => openKpi('reclaimable_licences')}
            viewLabel="List the licences to reclaim"
          />
          <KpiCard
            icon={ShieldAlert}
            tone="alert"
            accent="slate"
            label="Devices without services"
            value={data?.hygiene.devices_without_services ?? 0}
            caption="Active devices with no active service"
            loading={isLoading}
            onView={() => openKpi('devices_without_services')}
            viewLabel="List the devices without services"
          />
        </div>
      </Section>

      {portfolio && (
        <Section
          title="Portfolio"
          description="The whole managed estate across every customer."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={Building2}
              accent="indigo"
              label="Customers"
              value={portfolio.customers}
              caption={`${portfolio.devices} active devices`}
              loading={isLoading}
              onView={() => navigate('/msp/customers')}
              viewLabel="Open the customer list"
            />
            <KpiCard
              icon={Users}
              accent="blue"
              label="Active users"
              value={portfolio.active_client_users}
              caption={`${portfolio.client_users} on record`}
              loading={isLoading}
              onView={() => navigate('/msp/users?status=Active')}
              viewLabel="Open the user register"
            />
            <KpiCard
              icon={Layers}
              accent="emerald"
              label="Billable services"
              value={portfolio.billable_services}
              caption={`${portfolio.active_services} active assignments`}
              loading={isLoading}
              onView={() => openKpi('billable_services')}
              viewLabel="List the billable services"
            />
            <KpiCard
              icon={Laptop}
              accent="sky"
              label="Net change this month"
              value={`+${portfolio.added_this_month} / −${portfolio.removed_this_month}`}
              caption="Services started vs ended"
              loading={isLoading}
              onView={() => openKpi('services_added')}
              viewLabel="List the services started this month"
            />
          </div>

          <Panel title="Services in use">
            <table className="w-full">
              <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                <tr>
                  <Th>Service</Th>
                  <Th>Open assignments</Th>
                  <Th>Billable</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {portfolio.by_service.map((row) => (
                  <tr key={row.service} className="transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {row.service}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700 tabular-nums">
                      {row.total}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700 tabular-nums">
                      {row.billable}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {portfolio.rated_services === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No service carries an agreed rate yet, so revenue cannot be computed. Set rates on the
              assignments — or on the contract — before the first billing run.
            </p>
          )}
        </Section>
      )}

      <KpiDetailPanel
        open={Boolean(kpi)}
        title={kpiRows.data?.title ?? ''}
        description={kpiRows.data?.description}
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
        onOpenRow={(route) => {
          setKpi(null);
          navigate(route);
        }}
      />
    </div>
  );
}
