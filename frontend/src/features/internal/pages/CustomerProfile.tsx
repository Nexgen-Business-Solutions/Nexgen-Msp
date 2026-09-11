import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useSession } from '@/shared/hooks/useSession';
import CustomerModal from '../components/CustomerModal';
import { useCustomerDetails } from '../hooks/useCustomerDetails';

export default function CustomerProfile({ own = false }: { own?: boolean }) {
  const { customer: routeCustomer } = useParams();
  const { data: session } = useSession();
  const [selected, setSelected] = useState('');
  const customer = own ? selected || session?.customer || undefined : routeCustomer;
  const detail = useCustomerDetails(customer, own);
  const [editing, setEditing] = useState(false);
  const profile = detail.data;

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      {own && (session?.customers.length ?? 0) > 1 && (
        <label className="block text-sm font-medium text-slate-600">
          Company
          <select className="ml-3 rounded-lg border border-slate-200 bg-white p-2" value={customer} onChange={(event) => setSelected(event.target.value)}>
            {session?.customers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      {detail.isLoading && <p className="text-sm text-slate-500">Loading customer…</p>}
      {detail.error instanceof Error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{detail.error.message}</p>}
      {profile && !detail.isError && (
        <div className="space-y-6 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{profile.customer_name || profile.name}</h2>
              {profile.customer_type && <p className="text-sm text-slate-500">{profile.customer_type}</p>}
            </div>
            {profile.permissions?.can_edit && (
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Pencil size={15} /> Edit profile
              </button>
            )}
          </div>
          {profile.permissions && (
            <>
              <dl className="grid gap-5 sm:grid-cols-2">
                <div><dt className="text-xs font-semibold uppercase text-slate-400">Website</dt><dd className="mt-1 break-words text-sm text-slate-800">{profile.website || 'Not provided'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-slate-400">Address</dt><dd className="mt-1 text-sm text-slate-800">{profile.address ? [profile.address.address_line1, profile.address.address_line2, profile.address.city, profile.address.state, profile.address.pincode, profile.address.country].filter(Boolean).join(', ') : 'Not provided'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-slate-400">Email</dt><dd className="mt-1 break-words text-sm text-slate-800">{profile.address?.email_id || 'Not provided'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-slate-400">Phone</dt><dd className="mt-1 text-sm text-slate-800">{profile.address?.phone || 'Not provided'}</dd></div>
              </dl>
              <div className="space-y-3 border-t border-slate-100 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">Contacts</h3>
                {!profile.contacts?.length && <p className="text-sm text-slate-500">No contacts recorded.</p>}
                {profile.contacts?.map((contact) => (
                  <div key={contact.name} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-800">{[contact.first_name, contact.last_name].filter(Boolean).join(' ')}</p>
                    <p className="break-words text-sm text-slate-500">{[contact.email_id, contact.phone].filter(Boolean).join(' · ')}</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {editing && <CustomerModal open customer={profile.name} details={profile} onClose={() => setEditing(false)} />}
        </div>
      )}
    </div>
  );
}
