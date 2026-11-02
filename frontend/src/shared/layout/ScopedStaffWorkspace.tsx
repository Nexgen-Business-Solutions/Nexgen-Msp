import { useEffect } from 'react';
import { Link, Navigate, Outlet, useMatches, useNavigate } from 'react-router-dom';
import type { SessionContext } from '@/lib/api/session';
import { usePortalFilters } from '@/features/portal/store/usePortalFilters';
import { usePortalSummary } from '@/features/portal/hooks/usePortal';
import { scopedStaffSections } from './navigation';

function OperationsOverview() {
  const summary = usePortalSummary();
  const counts: Record<string, number | undefined> = {
    requests: summary.data?.open_requests,
    users: summary.data?.active_client_users,
    devices: summary.data?.active_devices,
    services: summary.data?.active_services,
  };
  return (
    <section className="px-6 py-4">
      <h2 className="mb-3 text-lg font-semibold">Customer operations</h2>
      {summary.isError && <p role="alert">The customer totals could not be loaded.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {scopedStaffSections[1].items.map(({ id, icon: Icon, path, label }) => (
          <Link key={id} to={path} className="rounded-xl border border-slate-200 bg-white p-4">
            <Icon size={20} className="mb-2 text-blue-700" />
            <span>{id === 'requests' ? 'Open requests' : 'Active ' + label.toLowerCase()}</span>
            <strong className="block text-xl">{counts[id] ?? '—'}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function ScopedStaffWorkspace({ session }: { session: SessionContext }) {
  const matches = useMatches();
  const navigate = useNavigate();
  const view = (matches[matches.length - 1].handle as { scopedView?: string } | undefined)?.scopedView;
  const selected = usePortalFilters((state) => state.customer);
  const setCustomer = usePortalFilters((state) => state.setCustomer);
  const customer = selected && session.customers.includes(selected) ? selected : session.customers[0] ?? null;

  useEffect(() => () => setCustomer(null), [setCustomer]);

  useEffect(() => {
    if (selected !== customer) setCustomer(customer);
  }, [selected, customer, setCustomer]);

  if (view !== 'home' && view !== 'resource') return <Navigate to="/msp" replace />;
  if (!customer) return <p className="mx-6 my-4 rounded-xl border bg-white p-5">No customer records are assigned to this workspace.</p>;

  return <>
    <div className="mx-6 mt-4 flex items-center gap-2">
      <label htmlFor="workspace-customer" className="font-medium">Customer</label>
      <select id="workspace-customer" value={customer} className="rounded-lg border bg-white px-3 py-2"
        onChange={(event) => { setCustomer(event.target.value); navigate('/msp'); }}>
        {session.customers.map((name) => <option key={name}>{name}</option>)}
      </select>
    </div>
    {selected === customer && (view === 'home' ? <OperationsOverview key={customer} /> : <Outlet key={customer} context={{ scopedStaff: true }} />)}
  </>;
}
