import { useNavigate } from 'react-router-dom';
import { Building2, CircleAlert, Coins, Eye, FileCheck2, Layers } from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import StatusBadge from '@/shared/components/StatusBadge';
import { useContractList } from '../hooks/useContracts';

const COLUMNS = ['Customer', 'Contract', 'Billing', 'Proration', 'Billable services', 'Rates set', 'Status', ''];

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

export default function CustomersList() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useContractList();

  const rows = data ?? [];
  const withContract = rows.filter((row) => row.profile).length;
  const active = rows.filter((row) => row.contract_status === 'Active').length;
  const fullyPriced = rows.filter(
    (row) => row.services_used > 0 && row.services_priced >= row.services_used
  ).length;
  const billable = rows.reduce((sum, row) => sum + row.billable_assignments, 0);

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Building2}
          accent="indigo"
          label="Customers"
          value={rows.length}
          caption={`${withContract} with a contract`}
          loading={isLoading}
        />
        <KpiCard
          icon={FileCheck2}
          accent="emerald"
          label="Active contracts"
          value={active}
          caption="Ready to be billed"
          loading={isLoading}
        />
        <KpiCard
          icon={Layers}
          accent="blue"
          label="Billable services"
          value={billable}
          caption="Across every customer"
          loading={isLoading}
        />
        <KpiCard
          icon={CircleAlert}
          tone="alert"
          accent="slate"
          label="Missing rates"
          value={rows.length - fullyPriced}
          caption="Customers with unpriced services"
          loading={isLoading}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Contracts and pricing</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            A service can only be invoiced once its customer has an active contract and a rate.
          </p>
        </div>

        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th
                    key={column}
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
                    {(error as Error)?.message || 'Failed to load customers.'}
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

              {!error &&
                !isLoading &&
                rows.map((row) => {
                  const priced = row.services_used > 0 && row.services_priced >= row.services_used;
                  return (
                    <tr
                      key={row.customer}
                      onClick={() => navigate(`/msp/customers/${encodeURIComponent(row.customer)}`)}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                        {row.customer}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                        {row.profile ? fmtDate(row.contract_start_date) : 'Not set up'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                        {row.billing_timing || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                        {row.proration_method || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex min-w-[2rem] justify-center rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 tabular-nums">
                          {row.billable_assignments}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`text-sm font-semibold tabular-nums ${
                            priced ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          {row.services_priced} / {row.services_used}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.contract_status ? (
                          <StatusBadge value={row.contract_status} />
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
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
    </div>
  );
}
