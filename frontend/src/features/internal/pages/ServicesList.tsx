import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import ColumnsModal from '@/shared/components/ColumnsModal';
import { INTERNAL_SERVICES, loadChoice } from '@/shared/exportColumns';
import { INTERNAL_SERVICE_LIST } from '@/shared/listColumns';
import type { CatalogueRow as ServiceRow } from '@/lib/api/internal';
import * as internal from '@/lib/api/internal';
import { Ban, CircleCheck, Package, Pencil, Plus, Users } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import ServiceModal from '../components/ServiceModal';
import type { CatalogueRow } from '@/lib/api/internal';
import { useServiceCatalogue } from '../hooks/useCatalogue';
import RemoveFromMspModal from '../components/RemoveFromMspModal';

// what MSP says, and what ERPNext says: two axes, never collapsed into one badge
const MSP_TONE: Record<string, string> = {
  Available: 'bg-emerald-100 text-emerald-700',
  'Not available': 'bg-slate-100 text-slate-600',
  'Needs configuration': 'bg-amber-100 text-amber-700',
};

const SCOPE_LABEL: Record<string, string> = {
  User: 'User',
  Device: 'Device',
  Both: 'Both',
};

const EMPTY: FilterState = { scope: '', status: '', focus: '' };

export default function ServicesList() {
  const [picking, setPicking] = useState(false);
  const [choosingColumns, setChoosingColumns] = useState(false);
  // what this person chose to see, kept in their browser
  const [visible, setVisible] = useState(() => loadChoice(INTERNAL_SERVICE_LIST).columns);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [search, setSearch] = useState('');

  const query = {
    search: search || undefined,
    scope: (filters.scope as string) || undefined,
    status: (filters.status as string) || undefined,
  };

  const { data, isLoading, error, refetch } = useServiceCatalogue(query);
  // the cards describe the whole catalogue; a filter narrows the list below, never them
  const everything = useServiceCatalogue({});

  const [modalOpen, setModalOpen] = useState(false);
  // a service already on file that is being offered again: the row says which one
  const [reoffering, setReoffering] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CatalogueRow | null>(null);

  const rows = data ?? [];
  const all = everything.data ?? [];
  const live = all.filter((row) => !row.disabled);
  // what a card puts in front of you, applied on top of the server's own filters
  const focus = (filters.focus as string) || '';
  const shown = rows.filter((row) =>
    focus === 'in_use'
      ? row.open_assignments > 0
      : focus === 'priced'
        ? row.priced_contracts > 0
        : focus === 'unpriced'
          ? row.priced_contracts === 0
          : true
  );
  const labels = Object.fromEntries(INTERNAL_SERVICE_LIST.columns.map((column) => [column.key, column.label]));
  const span = visible.length + 1;

  const cell = (key: string, row: ServiceRow) => {
    switch (key) {
      case 'service':
        return (
          <td key={key} className="px-4 py-3">
            <button
              type="button"
              onClick={() => navigate(`/msp/services/detail?item=${encodeURIComponent(row.name)}`)}
              className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
            >
              {row.service_name}
            </button>
            <p className="text-xs text-slate-400">{row.name}</p>
          </td>
        );
      case 'scope':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
            {SCOPE_LABEL[row.scope ?? ''] ?? <span className="text-slate-400">N/A</span>}
          </td>
        );
      case 'open_assignments':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span className="inline-flex min-w-[2.5rem] justify-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 tabular-nums">
              {row.open_assignments}
            </span>
          </td>
        );
      case 'customers':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
            {row.customers}
          </td>
        );
      case 'priced_contracts':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span
              className={`text-sm font-semibold tabular-nums ${
                row.priced_contracts ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {row.priced_contracts}
            </span>
          </td>
        );
      case 'msp_availability':
        return (
          <td key={key} className="whitespace-nowrap px-4 py-3">
            <span
              className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                MSP_TONE[row.msp_availability] ?? 'bg-slate-100 text-slate-600'
              }`}
            >
              {row.msp_availability}
            </span>
          </td>
        );
      default: {
        const value = row[key as 'stock_uom' | 'invoice_label' | 'description'];

        return (
          <td key={key} className="max-w-[18rem] px-4 py-3 text-sm text-slate-600">
            {value ? <span className="line-clamp-2" title={value}>{value}</span> : <span className="text-slate-400">N/A</span>}
          </td>
        );
      }
    }
  };
  const assignments = all.reduce((sum, row) => sum + row.open_assignments, 0);
  const unpriced = live.filter((row) => row.priced_contracts === 0).length;


  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Package}
          accent="blue"
          label="Services offered"
          value={live.length}
          caption={`${all.length - live.length} retired`}
          loading={isLoading}
        onView={() => setFilters({ ...EMPTY, status: 'active' })}
        />
        <KpiCard
          icon={Users}
          accent="emerald"
          label="Open assignments"
          value={assignments}
          caption="Across every customer"
          loading={isLoading}
        onView={() => setFilters({ ...EMPTY, focus: 'in_use' })}
        />
        <KpiCard
          icon={CircleCheck}
          accent="indigo"
          label="Priced somewhere"
          value={live.filter((row) => row.priced_contracts > 0).length}
          caption="Services with at least one contract rate"
          loading={isLoading}
        onView={() => setFilters({ ...EMPTY, status: 'active', focus: 'priced' })}
        />
        <KpiCard
          icon={Ban}
          tone="alert"
          accent="slate"
          label="Never priced"
          value={unpriced}
          caption="Deliverable but not billable anywhere"
          loading={isLoading}
        onView={() => setFilters({ ...EMPTY, status: 'active', focus: 'unpriced' })}
        />
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search MSP services…"
        subtitle="Narrow the catalogue."
        onSearch={setSearch}
        onApply={setFilters}
        onClear={() => {
          setFilters(EMPTY);
          setSearch('');
        }}
        onRefresh={() => refetch()}
        onExport={() => setPicking(true)}
        onColumns={() => setChoosingColumns(true)}
        fields={[
          {
            key: 'scope',
            label: 'Billed per',
            kind: 'select',
            allLabel: 'Any',
            options: Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            key: 'status',
            label: 'Status',
            kind: 'select',
            allLabel: 'Any status',
            options: [
              { value: 'Ready', label: 'Ready' },
              { value: 'Needs Configuration', label: 'Needs Configuration' },
              { value: 'ERPNext Disabled', label: 'ERPNext Disabled' },
              { value: 'Stock Item', label: 'Stock Item' },
              { value: 'Historical Only', label: 'Historical Only' },
            ],
          },
          {
            key: 'focus',
            label: 'Focus',
            kind: 'select',
            allLabel: 'Everything',
            options: [
              { value: 'in_use', label: 'In use', description: 'At least one open assignment' },
              { value: 'priced', label: 'Priced somewhere', description: 'A contract carries a rate' },
              { value: 'unpriced', label: 'Never priced', description: 'No contract carries a rate' },
            ],
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Service catalogue</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              What Nexgen sells, and how widely each one is in use.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReoffering(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={15} />
            Add service
          </button>
        </div>

        <div className="max-h-[62vh] overflow-auto px-5 pb-4">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {[...visible, ''].map((key, index) => (
                  <th
                    key={key || 'actions'}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === visible.length ? 'rounded-r-lg' : ''}`}
                  >
                    {labels[key] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!!error && (
                <tr>
                  <td colSpan={span} className="px-4 py-12 text-center text-sm text-red-600">
                    {(error as Error)?.message || 'Failed to load the catalogue.'}
                  </td>
                </tr>
              )}

              {!error && isLoading && (
                <tr>
                  <td colSpan={span} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!error && !isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={span} className="px-4 py-12 text-center text-sm text-slate-500">
                    No service yet.
                  </td>
                </tr>
              )}

              {!error &&
                !isLoading &&
                shown.map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50">
                    {visible.map((key) => cell(key, row))}
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={
                            [
                              {
                                label: 'Open service',
                                icon: Pencil,
                                onClick: () =>
                                  navigate(`/msp/services/detail?item=${encodeURIComponent(row.name)}`),
                              },
                              {
                                label: 'Remove from MSP',
                                icon: Ban,
                                onClick: () => setRemoving(row),
                                danger: true,
                                disabled: !row.msp_enabled,
                              },
                              {
                                label: 'Make available in MSP',
                                icon: CircleCheck,
                                onClick: () => {
                                  setReoffering(row.name);
                                  setModalOpen(true);
                                },
                                disabled: Boolean(row.msp_enabled),
                              },
                            ] as RowAction[]
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <ServiceModal
        open={modalOpen}
        item={reoffering}
        onClose={() => {
          setModalOpen(false);
          setReoffering(null);
        }}
      />

      <RemoveFromMspModal service={removing} onClose={() => setRemoving(null)} />


      <ColumnsModal
        open={choosingColumns}
        mode="listing"
        catalogue={INTERNAL_SERVICE_LIST}
        onClose={() => setChoosingColumns(false)}
        onConfirm={(choice) => setVisible(choice.columns)}
      />

      <ColumnsModal
        open={picking}
        catalogue={INTERNAL_SERVICES}
        onClose={() => setPicking(false)}
        onConfirm={(picks) => internal.exportServices(query, picks)}
      />
    </div>
  );
}
