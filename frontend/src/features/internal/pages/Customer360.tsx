import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  FileText,
  Laptop,
  Lock,
  Mail,
  MapPin,
  Phone,
  Users,
} from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import {
  useCustomerDetails,
  useCustomerOptions,
  useSaveCustomerDetails,
} from '../hooks/useCustomerDetails';

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const Panel = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
    {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

const Stat = ({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2">
    <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <Icon size={12} />
      {label}
    </p>
    <p className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">{value}</p>
  </div>
);

/**
 * One company, read by whoever opened it.
 *
 * There is one page, not one per role. What changes is which sections it draws and what it
 * lets you type, and it is told that by the backend rather than working it out from roles.
 */
export default function Customer360() {
  const { customer = '' } = useParams();
  const navigate = useNavigate();
  const detail = useCustomerDetails(customer);
  const options = useCustomerOptions();
  const save = useSaveCustomerDetails();

  const [website, setWebsite] = useState('');
  const [commercial, setCommercial] = useState<Record<string, string>>({});
  const [address, setAddress] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<Record<string, string>>({});

  const data = detail.data;

  useEffect(() => {
    if (!data) return;

    setWebsite(data.website ?? '');
    setCommercial({
      customer_group: data.customer_group ?? '',
      territory: data.territory ?? '',
      tax_id: data.tax_id ?? '',
      default_currency: data.default_currency ?? '',
      default_price_list: data.default_price_list ?? '',
      payment_terms: data.payment_terms ?? '',
    });
    setAddress({
      address_line1: data.address?.address_line1 ?? '',
      address_line2: data.address?.address_line2 ?? '',
      city: data.address?.city ?? '',
      state: data.address?.state ?? '',
      pincode: data.address?.pincode ?? '',
      country: data.address?.country ?? '',
      phone: data.address?.phone ?? '',
      email_id: data.address?.email_id ?? '',
    });
    setContact({
      name: data.contact?.name ?? '',
      first_name: data.contact?.first_name ?? '',
      last_name: data.contact?.last_name ?? '',
      email_id: data.contact?.email_id ?? '',
      phone: data.contact?.phone ?? '',
    });
  }, [data]);

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'Customer not found.'}
        </div>
      </div>
    );
  }

  const canEditProfile = data.can.edit_profile;
  const canEditCommercial = data.can.edit_commercial;
  const sharedAddress = data.shared.address;
  const sharedContact = Boolean(data.contact?.shared);

  const submit = () =>
    save.mutate({
      customer,
      details: canEditCommercial
        ? { website, ...commercial }
        : canEditProfile
          ? { website }
          : {},
      address: canEditProfile && !sharedAddress ? address : undefined,
      contact:
        canEditProfile && !sharedContact
          ? { ...contact, name: contact.name || undefined }
          : undefined,
    });

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/customers')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to companies
      </button>

      <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="inline-flex items-center gap-2 text-lg font-bold text-slate-900">
              <Building2 size={18} className="text-slate-400" />
              {data.customer_name || data.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {[data.customer_group, data.territory].filter(Boolean).join(' · ') ||
                'No commercial grouping'}
            </p>
            {data.website && (
              <a
                href={data.website}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-block text-sm text-blue-600 hover:underline"
              >
                {data.website}
              </a>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="People" value={data.counts.users} icon={Users} />
            <Stat label="Machines" value={data.counts.devices} icon={Laptop} />
            <Stat label="Contracts" value={data.counts.contracts} icon={FileText} />
          </div>
        </div>
        {(data.can.manage_contracts || data.can.manage_pricing) && (
          <button
            type="button"
            onClick={() =>
              navigate(`/msp/customers/${encodeURIComponent(data.name)}/contract`)
            }
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileText size={15} />
            Contract and pricing
          </button>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Where they are"
          subtitle={sharedAddress ? undefined : 'The address every invoice is billed to.'}
        >
          {sharedAddress && (
            <p className="mb-3 inline-flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <Lock size={13} className="mt-0.5 shrink-0 text-slate-400" />
              This address is shared with another company. Ask your service provider to
              update it.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['address_line1', 'Address'],
              ['address_line2', 'Address line 2'],
              ['city', 'City'],
              ['state', 'State'],
              ['pincode', 'Postcode'],
              ['phone', 'Phone'],
              ['email_id', 'Email'],
            ].map(([field, label]) => (
              <div key={field}>
                <FieldLabel>{label}</FieldLabel>
                <input
                  className={inputClass}
                  value={address[field] ?? ''}
                  disabled={!canEditProfile || sharedAddress}
                  onChange={(event) =>
                    setAddress((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
              </div>
            ))}
            <div>
              <FieldLabel>Country</FieldLabel>
              {canEditProfile && !sharedAddress ? (
                <Select
                  searchable
                  className="w-full"
                  value={address.country ?? ''}
                  onChange={(value) => setAddress((current) => ({ ...current, country: value }))}
                  placeholder="Select a country"
                  options={(options.data?.countries ?? []).map((name) => ({
                    value: name,
                    label: name,
                  }))}
                />
              ) : (
                <p className={`${inputClass} flex items-center bg-slate-50 text-slate-500`}>
                  {address.country || 'Not set'}
                </p>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Who to call" subtitle="The person we reach at this company.">
          {sharedContact && (
            <p className="mb-3 inline-flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <Lock size={13} className="mt-0.5 shrink-0 text-slate-400" />
              This contact is shared with another company and is read-only here.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['first_name', 'First name'],
              ['last_name', 'Last name'],
              ['email_id', 'Email'],
              ['phone', 'Phone'],
            ].map(([field, label]) => (
              <div key={field}>
                <FieldLabel>{label}</FieldLabel>
                <input
                  className={inputClass}
                  value={contact[field] ?? ''}
                  disabled={!canEditProfile || sharedContact}
                  onChange={(event) =>
                    setContact((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-slate-400">
            An email here is how we reach them. It grants nobody an account: portal access is
            handed out on the accounts screen.
          </p>

          {canEditProfile && (
            <div className="mt-3">
              <FieldLabel>Website</FieldLabel>
              <input
                className={inputClass}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://acme.example"
              />
            </div>
          )}
        </Panel>
      </div>

      {canEditCommercial && (
        <Panel
          title="Commercial terms"
          subtitle="What this company is sold on. Ours to set, never theirs."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel>Customer group</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={commercial.customer_group ?? ''}
                onChange={(value) =>
                  setCommercial((current) => ({ ...current, customer_group: value }))
                }
                placeholder="Select"
                options={(options.data?.customer_groups ?? []).map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Territory</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={commercial.territory ?? ''}
                onChange={(value) =>
                  setCommercial((current) => ({ ...current, territory: value }))
                }
                placeholder="Select"
                options={(options.data?.territories ?? []).map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Currency</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={commercial.default_currency ?? ''}
                onChange={(value) =>
                  setCommercial((current) => ({ ...current, default_currency: value }))
                }
                placeholder="Select"
                options={(options.data?.currencies ?? []).map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Price list</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={commercial.default_price_list ?? ''}
                onChange={(value) =>
                  setCommercial((current) => ({ ...current, default_price_list: value }))
                }
                placeholder="Select"
                options={(options.data?.price_lists ?? []).map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Payment terms</FieldLabel>
              <Select
                searchable
                className="w-full"
                value={commercial.payment_terms ?? ''}
                onChange={(value) =>
                  setCommercial((current) => ({ ...current, payment_terms: value }))
                }
                placeholder="Select"
                options={(options.data?.payment_terms ?? []).map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
            <div>
              <FieldLabel>Tax ID</FieldLabel>
              <input
                className={inputClass}
                value={commercial.tax_id ?? ''}
                onChange={(event) =>
                  setCommercial((current) => ({ ...current, tax_id: event.target.value }))
                }
              />
            </div>
          </div>
        </Panel>
      )}

      {!canEditCommercial && (
        <Panel title="Commercial terms" subtitle="Set by your service provider.">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ['Currency', data.default_currency],
              ['Price list', data.default_price_list],
              ['Payment terms', data.payment_terms],
              ['Tax ID', data.tax_id],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="text-slate-700">{value || 'Not set'}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      {(canEditProfile || canEditCommercial) && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={save.isLoading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {save.isLoading ? 'Saving…' : 'Save changes'}
          </button>

          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin size={12} />
            The address, the contact and the company are saved together or not at all.
          </span>
        </div>
      )}

      {save.error instanceof Error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {save.error.message}
        </p>
      )}

      {data.contact && (
        <p className="flex flex-wrap items-center gap-x-4 text-xs text-slate-400">
          {data.contact.email_id && (
            <span className="inline-flex items-center gap-1">
              <Mail size={11} />
              {data.contact.email_id}
            </span>
          )}
          {data.contact.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone size={11} />
              {data.contact.phone}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
