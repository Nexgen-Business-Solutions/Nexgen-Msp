import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, Layers, Package, Search, Users } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import { useCatalogue, useSubscribedServices } from '../hooks/usePortal';
import { useMyApprovalRights } from '../hooks/usePortal';

/**
 * Every service this company may order, not only the ones it already runs.
 *
 * A customer comes here to ask for something new as often as to look at what they hold, so
 * the page is the catalogue their contract covers, with what they already use shown beside
 * each line.
 */
export default function PortalServices() {
  const rights = useMyApprovalRights();
  const canSubmit = rights.data?.can_submit !== false;
  const navigate = useNavigate();
  const catalogue = useCatalogue();
  const subscribed = useSubscribedServices();
  const [search, setSearch] = useState('');
  // what a card puts in front of you: everything, what runs, or what nobody holds yet
  const [view, setView] = useState<'all' | 'in_use' | 'unused'>('all');

  const inUse = useMemo(() => {
    const held = new Map<string, number>();

    for (const row of subscribed.data?.services ?? []) {
      held.set(row.service_item, (held.get(row.service_item) ?? 0) + row.active);
    }

    return held;
  }, [subscribed.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const items = (catalogue.data?.items ?? []).filter((item) =>
      view === 'in_use' ? inUse.has(item.name) : view === 'unused' ? !inUse.has(item.name) : true
    );

    if (!needle) return items;

    return items.filter((item) =>
      `${item.item_name} ${item.name}`.toLowerCase().includes(needle)
    );
  }, [catalogue.data, search, view, inUse]);

  const running = [...inUse.values()].reduce((sum, count) => sum + count, 0);

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={Package}
          accent="blue"
          label="Services available"
          value={catalogue.data?.items.length ?? 0}
          caption="What your contract lets you order"
          loading={catalogue.isLoading}
        onView={() => setView('all')}
        />
        <KpiCard
          icon={Layers}
          accent="indigo"
          label="Active licences"
          value={running}
          caption="Running right now"
          loading={subscribed.isLoading}
        onView={() => setView('in_use')}
        />
        <KpiCard
          icon={FilePlus2}
          accent="slate"
          label="Not used yet"
          value={Math.max((catalogue.data?.items.length ?? 0) - inUse.size, 0)}
          caption="Covered by your contract, nobody holds them"
          loading={catalogue.isLoading}
        onView={() => setView('unused')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', 'Everything'],
            ['in_use', 'In use'],
            ['unused', 'Not used yet'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              view === value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search a service…"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>

      <DataTable
        title="Services you can order"
        columns={['Service', 'Billed to', 'In use', '']}
        rowCount={rows.length}
        isLoading={catalogue.isLoading}
        error={catalogue.error}
        emptyLabel={
          catalogue.data && !catalogue.data.has_contract
            ? 'No live contract yet, so there is nothing to order. Ask us to set one up.'
            : 'Your contract covers no service yet.'
        }
        showToolbar={false}
      >
        {rows.map((item) => {
          const scope = item.scope || 'User';
          const onDevices = scope === 'Device';
          const held = inUse.get(item.name) ?? 0;
          const holders = `/msp/${onDevices ? 'devices' : 'users'}?service=${encodeURIComponent(
            item.name
          )}`;

          return (
            <tr key={item.name} className="transition-colors hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{item.item_name}</p>
                {item.description && (
                  <p className="mt-0.5 text-xs text-slate-400">{item.description}</p>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-slate-300" />
                  {onDevices ? 'Per machine' : scope === 'Both' ? 'Person or machine' : 'Per person'}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums">
                {held > 0 ? (
                  <span className="font-semibold text-emerald-700">{held}</span>
                ) : (
                  <span className="text-slate-300">None</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex justify-end">
                  <RowActionsMenu
                    actions={[
                      ...(canSubmit
                        ? [
                      {
                        label: 'Ask for this service',
                        icon: FilePlus2,
                        onClick: () =>
                          navigate(`/msp/requests/new?service=${encodeURIComponent(item.name)}`),
                      },
                          ]
                        : []),
                      {
                        label: onDevices ? 'See the machines' : 'See the people',
                        icon: Users,
                        disabled: held === 0,
                        onClick: () => navigate(holders),
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
