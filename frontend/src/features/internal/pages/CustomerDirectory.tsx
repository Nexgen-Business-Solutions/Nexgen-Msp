import { useState } from 'react';
import { Link } from 'react-router-dom';
import Breadcrumb from '@/shared/layout/Breadcrumb';
import { useCustomerList } from '../hooks/useCustomerDetails';

export default function CustomerDirectory() {
  const customers = useCustomerList();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const rows = (customers.data ?? []).filter((row) => `${row.name} ${row.customer_name}`.toLowerCase().includes(needle));

  return (
    <>
      <Breadcrumb />
      <div className="space-y-4 px-6 pb-6 pt-4">
        <input aria-label="Search customers" type="search" placeholder="Search customers…" value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm sm:max-w-sm" />
        {customers.error instanceof Error && <p role="alert" className="text-sm text-red-700">{customers.error.message}</p>}
        {customers.isLoading && <p className="text-sm text-slate-500">Loading customers…</p>}
        {!customers.isLoading && !customers.isError && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white shadow-sm">
            {rows.map((row) => (
              <Link key={row.name} to={`/msp/customers/${encodeURIComponent(row.name)}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                <span className="text-sm font-semibold text-slate-900">{row.customer_name || row.name}</span>
                <span className="text-xs text-slate-500">{row.customer_type}</span>
              </Link>
            ))}
            {!rows.length && <p className="p-5 text-sm text-slate-500">No customers found.</p>}
          </div>
        )}
      </div>
    </>
  );
}
