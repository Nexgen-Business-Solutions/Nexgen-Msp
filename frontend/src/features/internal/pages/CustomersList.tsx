import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CircleAlert, Coins, Eye, FileCheck2, Layers, Plus, SearchX } from 'lucide-react';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import { useContractList } from '../hooks/useContracts';
import CustomerModal from '../components/CustomerModal';

const COLUMNS = ['Customer', 'Contract', 'Frequency', 'Active services', 'Billable services', 'Rates set', 'Billed up to', 'Status', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

export default function CustomersList() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useContractList();

  const [filters, setFilters] = useState<FilterState>({ contract_status: '', priced: '', focus: '' });
  const [search, setSearch] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const all = useMemo(() => data ?? [], [data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return all.filter((row) => {
      if (needle && !row.customer.toLowerCase().includes(needle)) return false;

      if (liveOnly && row.contract_status !== 'Active') return false;

      if (filters.contract_status && row.contract_status !== filters.contract_status) return false;

      if (filters.focus === 'billable' && row.billable_assignments === 0) return false;

      if (filters.priced === 'complete') {
        return row.services_used > 0 && row.services_priced >= row.services_used;
      }

      if (filters.priced === 'incomplete') {
        return row.services_used === 0 || row.services_priced < row.services_used;
      }

      return true;
    });
  }, [all, filters, search, liveOnly]);
  const withContract = all.filter((row) => row.contract).length;
  const active = all.filter((row) => row.contract_status === 'Active').length;
  const fullyPriced = all.filter(
    (row) => row.services_used > 0 && row.services_priced >= row.services_used
  ).length;
  const billable = all.reduce((sum, row) => sum + row.billable_assignments, 0);

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Building2}
          accent="indigo"
          label="Customers"
          value={all.length}
          caption={`${withContract} with a contract`}
          loading={isLoading}
          onView={() => { setFilters({ contract_status: '', priced: '', focus: '' }); setLiveOnly(false); }}
        />
        <KpiCard
          icon={FileCheck2}
          accent="emerald"
          label="Active contracts"
          value={active}
          caption="Ready to be billed"
          loading={isLoading}
          onView={() => setFilters({ contract_status: 'Active', priced: '', focus: '' })}
        />
        <KpiCard
          icon={Layers}
          accent="blue"
          label="Billable services"
          value={billable}
          caption="Across every customer"
          loading={isLoading}
          onView={() => setFilters({ contract_status: '', priced: '', focus: 'billable' })}
        />
        <KpiCard
          icon={CircleAlert}
          tone="alert"
          accent="slate"
          label="Missing rates"
          value={all.length - fullyPriced}
          caption="Customers with unpriced services"
          loading={isLoading}
          onView={() => setFilters({ contract_status: '', priced: 'incomplete', focus: '' })}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
        >
          <Plus size={15} />
          New customer
        </button>
      </div>

      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search a customer…"
        subtitle="Narrow the customer register."
        onSearch={setSearch}
        onApply={setFilters}
        onClear={() => setFilters({ contract_status: '', priced: '', focus: '' })}
        onRefresh={() => refetch()}
        toggle={{
          label: 'Active contract only',
          checked: liveOnly,
          onChange: setLiveOnly,
          title: 'Only the customers a run can actually be generated for',
        }}
        fields={[
          {
            key: 'contract_status',
            label: 'Contract',
            kind: 'select',
            allLabel: 'Any contract state',
            options: ['Draft', 'Active', 'Suspended', 'Ended'].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            key: 'priced',
            label: 'Pricing',
            kind: 'select',
            allLabel: 'Any pricing state',
            options: [
              { value: 'complete', label: 'Fully priced', description: 'Every service has a rate' },
              {
                value: 'incomplete',
                label: 'Rates missing',
                description: 'Cannot be billed as it stands',
              },
            ],
          },
          {
            key: 'focus',
            label: 'Focus',
            kind: 'select',
            allLabel: 'Everything',
            options: [{ value: 'billable', label: 'With billable services' }],
          },
        ]}
      />

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Contracts and pricing</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              A service can only be invoiced once its customer has an active contract and a rate.
            </p>
          </div>
          {!isLoading && !error && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200">
              {rows.length}
            </span>
          )}
        </div>

        <div className="max-h-[62vh] overflow-auto px-2 pb-1 sm:px-3">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    className="whitespace-nowrap border-b border-slate-200 px-4 pb-3 pt-4 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
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
                    {(error as Error)?.message || 'Failed to load customers.'}
                  </td>
                </tr>
              )}

              {!error && isLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12">
                    <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
                      <span className="size-5 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
                      Loading…
                    </div>
                  </td>
                </tr>
              )}

              {!error && !isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12">
                    <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                        <SearchX className="size-[18px]" strokeWidth={1.75} />
                      </span>
                      No company matches these filters.
                    </div>
                  </td>
                </tr>
              )}

              {!error &&
                !isLoading &&
                rows.map((row) => {
                  const priced = row.services_used > 0 && row.services_priced >= row.services_used;
                  return (
                    <tr
                      key={row.customer}
                      onClick={() => navigate(`/msp/customers/${encodeURIComponent(row.customer)}`)}
                      className="cursor-pointer transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100"
                        >
                          <Building2 size={16} strokeWidth={1.75} />
                        </span>
                        {/* the row stays clickable, but the name is a real control: without
                            one, this register was the only listing no keyboard could open */}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/msp/customers/${encodeURIComponent(row.customer)}`);
                          }}
                          className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
                        >
                          {row.customer}
                        </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                        {row.contract ? (
                          <>
                            {row.contract_title || row.contract}<br />
                            <span className="text-xs text-slate-500">
                              since {fmtDate(row.contract_start_date)}
                            </span>
                          </>
                        ) : (
                          <span className="font-medium text-amber-600">No contract</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                        {row.billing_frequency || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 tabular-nums ring-1 ring-emerald-100">
                          {row.active_services}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums ring-1 ring-slate-200">
                          {row.billable_assignments}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ${
                            priced
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                              : 'bg-amber-50 text-amber-700 ring-amber-200'
                          }`}
                        >
                          {row.services_priced} / {row.services_used}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {row.last_billed_on ? (
                          fmtDate(row.last_billed_on)
                        ) : (
                          <span className="text-slate-400">Never</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.contract_status ? (
                          <StatusBadge value={row.contract_status} />
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                            NO CONTRACT
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex justify-end">
                          <RowActionsMenu
                            actions={[
                              {
                                label: 'Contract and pricing',
                                icon: Eye,
                                onClick: () =>
                                  navigate(`/msp/customers/${encodeURIComponent(row.customer)}`),
                              },
                              {
                                label: 'Their billing runs',
                                icon: Coins,
                                onClick: () =>
                                  navigate(`/msp/billing?customer=${encodeURIComponent(row.customer)}`),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerModal
        open={creating}
        customer=""
        details={null}
        onClose={() => setCreating(false)}
        onCreated={(customer) => navigate(`/msp/customers/${encodeURIComponent(customer)}`)}
      />
    </div>
  );
}
