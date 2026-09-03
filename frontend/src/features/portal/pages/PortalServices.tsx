import { useNavigate } from 'react-router-dom';
import { FilePlus2, Layers, Package, Recycle, Users } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { usePortalSummary, useSubscribedServices } from '../hooks/usePortal';

export default function PortalServices() {
  const navigate = useNavigate();
  const services = useSubscribedServices();
  const summary = usePortalSummary();

  const rows = services.data?.services ?? [];

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={Package}
          accent="blue"
          label="Distinct services"
          value={rows.length}
          caption="What your company subscribes to"
          loading={services.isLoading}
        />
        <KpiCard
          icon={Layers}
          accent="indigo"
          label="Active licences"
          value={summary.data?.active_services ?? 0}
          caption="Running right now"
          loading={summary.isLoading}
        />
        <KpiCard
          icon={Recycle}
          tone="alert"
          accent="slate"
          label="Reclaimable"
          value={summary.data?.reclaimable_licences ?? 0}
          caption="Still billed for someone who left"
          loading={summary.isLoading}
        />
      </div>

      <DataTable
        title="Subscribed services"
        columns={['Service', 'Billed to', 'Active', 'Ended', 'Total', '']}
        rowCount={rows.length}
        isLoading={services.isLoading}
        error={services.error}
        emptyLabel="Nothing subscribed yet."
        showToolbar={false}
      >
        {rows.map((row) => {
          // a device service is held by machines, a user service by people: the option
          // leads to whichever listing actually answers "who has this"
          const onDevices = row.assignment_scope === 'Device';
          const holders = `/msp/${onDevices ? 'devices' : 'users'}?service=${encodeURIComponent(
            row.service_item
          )}`;

          return (
            <tr key={row.service_item} className="transition-colors hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">{row.item_name}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-slate-300" />
                  {onDevices ? 'Per machine' : 'Per person'}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-emerald-700 tabular-nums">
                {row.active}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400 tabular-nums">
                {row.ended}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                {row.total}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex justify-end">
                  <RowActionsMenu
                    actions={[
                      {
                        label: onDevices ? 'See the machines' : 'See the people',
                        icon: Users,
                        onClick: () => navigate(holders),
                      },
                      {
                        label: 'Raise a request for this service',
                        icon: FilePlus2,
                        onClick: () =>
                          navigate(
                            `/msp/requests/new?service=${encodeURIComponent(row.service_item)}`
                          ),
                      },
                    ]}
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}
