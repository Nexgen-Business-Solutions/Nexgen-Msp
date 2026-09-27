import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, Layers, Package, Search, Users } from 'lucide-react';
import DataTable from '@/shared/components/DataTable';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import Select from '@/shared/components/Select';
import type { ServicePortfolioRow } from '@/lib/api/portal';
import { useMyApprovalRights, useServicePortfolio } from '../hooks/usePortal';

const AVAILABILITY_TONE: Record<ServicePortfolioRow['availability'], string> = {
  'Available to request': 'bg-emerald-100 text-emerald-700',
  'History only': 'bg-slate-100 text-slate-600',
  'Temporarily unavailable': 'bg-amber-100 text-amber-700',
};

const SCOPE_LABEL: Record<string, string> = {
  User: 'Per person',
  Device: 'Per machine',
  Both: 'Person or machine',
};

/** A service is in use when something is actually running, not merely because it is on file. */
const inUse = (row: ServicePortfolioRow) =>
  row.active > 0 || row.suspended > 0 || row.pending_setup > 0;

const VIEWS = [
  ['all', 'All services'],
  ['available', 'Available'],
  ['in_use', 'In use'],
  ['ended', 'Ended'],
] as const;

/**
 * The company's service portfolio: what it may ask for, what it runs, and what it has run.
 *
 * A service that ended stays here. It is part of what this company has had, and hiding it
 * would make the history unreadable the moment the last assignment closed.
 */
export default function PortalServices() {
  const rights = useMyApprovalRights();
  const canSubmit = rights.data?.can_submit === true;
  const navigate = useNavigate();
  const portfolio = useServicePortfolio();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('all');

  const all = useMemo(() => portfolio.data?.rows ?? [], [portfolio.data]);

  const countOf = (scope: (typeof VIEWS)[number][0]) =>
    all.filter((row) =>
      scope === 'available'
        ? row.availability === 'Available to request'
        : scope === 'in_use'
          ? inUse(row)
          : scope === 'ended'
            ? row.ended > 0
            : true
    ).length;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const kept = all.filter((row) =>
      view === 'available'
        ? row.availability === 'Available to request'
        : view === 'in_use'
          ? inUse(row)
          : view === 'ended'
            ? row.ended > 0
            : true
    );

    if (!needle) return kept;

    return kept.filter((row) =>
      `${row.service_name} ${row.service_item}`.toLowerCase().includes(needle)
    );
  }, [all, search, view]);

  const running = all.reduce((sum, row) => sum + row.active, 0);
  const available = all.filter((row) => row.availability === 'Available to request').length;
  const ended = all.filter((row) => row.ended > 0 && !inUse(row)).length;

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Services</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Services available to your company, currently assigned services, and service history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={Package}
          accent="blue"
          label="Available to request"
          value={available}
          caption="Covered by a live contract and ready"
          loading={portfolio.isLoading}
          onView={() => setView('available')}
        />
        <KpiCard
          icon={Layers}
          accent="indigo"
          label="Active assignments"
          value={running}
          caption="Currently running service assignments"
          loading={portfolio.isLoading}
          onView={() => setView('in_use')}
        />
        <KpiCard
          icon={FilePlus2}
          accent="slate"
          label="History only"
          value={ended}
          caption="Ran in the past, nothing running now"
          loading={portfolio.isLoading}
          onView={() => setView('ended')}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search a service…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>
        <Select
          className="w-44 shrink-0"
          value={view}
          onChange={(value) => setView(value as (typeof VIEWS)[number][0])}
          options={VIEWS.map(([value, label]) => ({
            value,
            label,
            description: `${countOf(value)} service(s)`,
          }))}
        />
      </div>

      <DataTable
        title="Service portfolio"
        columns={['Service', 'Availability', 'Active', 'Suspended', 'Ended', 'Scope', '']}
        rowCount={rows.length}
        isLoading={portfolio.isLoading}
        error={portfolio.error}
        emptyLabel={
          portfolio.data && !portfolio.data.has_contract
            ? 'No live contract yet, so there is nothing to order. Ask us to set one up.'
            : 'No service is recorded for your company yet.'
        }
        showToolbar={false}
        showPagination={false}
      >
        {rows.map((row) => {
          const onDevices = row.scope === 'Device';
          const holders = `/msp/${onDevices ? 'devices' : 'users'}?service=${encodeURIComponent(
            row.service_item
          )}`;
          const requestable = row.availability === 'Available to request' && canSubmit;

          return (
            <tr key={row.service_item} className="transition-colors hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{row.service_name}</p>
                <p className="text-xs text-slate-400">{row.service_item}</p>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <span
                  className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                    AVAILABILITY_TONE[row.availability]
                  }`}
                >
                  {row.availability}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums">
                {row.active > 0 ? (
                  <span className="font-semibold text-emerald-700">{row.active}</span>
                ) : (
                  <span className="text-slate-300">0</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums">
                {row.suspended > 0 ? (
                  <span className="font-semibold text-amber-700">{row.suspended}</span>
                ) : (
                  <span className="text-slate-300">0</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums">
                {row.ended > 0 ? (
                  <span className="font-semibold text-slate-700">{row.ended}</span>
                ) : (
                  <span className="text-slate-300">0</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-slate-300" />
                  {SCOPE_LABEL[row.scope] ?? row.scope}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex justify-end">
                  {requestable ? (
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'Request change',
                          icon: FilePlus2,
                          onClick: () =>
                            navigate(
                              `/msp/requests/new?service=${encodeURIComponent(row.service_item)}`
                            ),
                        },
                        {
                          label: onDevices ? 'See the machines' : 'See the people',
                          icon: Users,
                          disabled: !inUse(row),
                          onClick: () => navigate(holders),
                        },
                      ]}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(holders)}
                      disabled={row.total === 0}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      View assignments
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}
