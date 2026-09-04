import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import * as internal from '@/lib/api/internal';
import { Ban, CircleCheck, Package, Pencil, Plus, Users } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import ConfirmModal from '@/shared/components/ConfirmModal';
import ServiceModal from '../components/ServiceModal';
import type { CatalogueRow } from '@/lib/api/internal';
import { useSaveService, useServiceCatalogue } from '../hooks/useCatalogue';

const COLUMNS = ['Service', 'Billed per', 'Open assignments', 'Customers', 'Priced contracts', 'Status', ''];

const SCOPE_LABEL: Record<string, string> = {
  User: 'Per user',
  Device: 'Per device',
  Both: 'User or device',
};

const EMPTY: FilterState = { scope: '', status: '', focus: '' };

export default function ServicesList() {
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
  const save = useSaveService();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogueRow | null>(null);
  const [toggling, setToggling] = useState<CatalogueRow | null>(null);

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
  const assignments = all.reduce((sum, row) => sum + row.open_assignments, 0);
  const unpriced = live.filter((row) => row.priced_contracts === 0).length;

  const open = (service: CatalogueRow | null) => {
    setEditing(service);
    setModalOpen(true);
  };

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
        searchPlaceholder="Search a service, its code or its invoice label…"
        subtitle="Narrow the catalogue."
        onSearch={setSearch}
        onApply={setFilters}
        onClear={() => {
          setFilters(EMPTY);
          setSearch('');
        }}
        onRefresh={() => refetch()}
        onExport={() => internal.exportServices(query)}
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
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled' },
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
              What can be assigned and billed. The scope decides whether a licence follows a person
              or a machine.
            </p>
          </div>
          <button
            type="button"
            onClick={() => open(null)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={15} />
            New service
          </button>
        </div>

        <div className="max-h-[62vh] overflow-auto px-5 pb-4">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column || index}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!!error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-red-600">
                    {(error as Error)?.message || 'Failed to load the catalogue.'}
                  </td>
                </tr>
              )}

              {!error && isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!error && !isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-500">
                    No service yet.
                  </td>
                </tr>
              )}

              {!error &&
                !isLoading &&
                shown.map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/msp/services/${row.name}`)}
                        className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
                      >
                        {row.item_name}
                      </button>
                      <p className="text-xs text-slate-400">{row.name}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {SCOPE_LABEL[row.scope ?? ''] ?? 'Per user'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex min-w-[2.5rem] justify-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                        {row.open_assignments}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                      {row.customers}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          row.priced_contracts ? 'text-emerald-600' : 'text-amber-600'
                        }`}
                      >
                        {row.priced_contracts}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.disabled ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                          RETIRED
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          OFFERED
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={
                            [
                              { label: 'Edit service', icon: Pencil, onClick: () => open(row) },
                              {
                                label: 'Retire from catalogue',
                                icon: Ban,
                                onClick: () => setToggling(row),
                                danger: true,
                                disabled: Boolean(row.disabled),
                              },
                              {
                                label: 'Offer again',
                                icon: CircleCheck,
                                onClick: () => setToggling(row),
                                disabled: !row.disabled,
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

      <ServiceModal open={modalOpen} service={editing} onClose={() => setModalOpen(false)} />

      <ConfirmModal
        open={Boolean(toggling)}
        tone={toggling?.disabled ? 'info' : 'danger'}
        title={
          toggling?.disabled
            ? `Offer ${toggling.item_name} again?`
            : `Retire ${toggling?.item_name} from the catalogue?`
        }
        description={
          toggling?.disabled
            ? 'It becomes assignable again straight away.'
            : `It can no longer be assigned. ${toggling?.open_assignments ?? 0} open assignment(s) must be ended first.`
        }
        confirmLabel={toggling?.disabled ? 'Offer again' : 'Retire'}
        loading={save.isLoading}
        onCancel={() => setToggling(null)}
        onConfirm={async () => {
          if (!toggling) return;
          try {
            await save.mutateAsync({
              name: toggling.name,
              item_name: toggling.item_name,
              scope: toggling.scope ?? 'User',
              disabled: toggling.disabled ? 0 : 1,
            });
            setToggling(null);
          } catch {
            // the modal stays open; the message is shown below
          }
        }}
      />

      {save.error instanceof Error && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
          {save.error.message}
        </div>
      )}
    </div>
  );
}
