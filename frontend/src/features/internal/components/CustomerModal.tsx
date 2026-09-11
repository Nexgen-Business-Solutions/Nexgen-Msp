import React, { useEffect, useState } from 'react';
import { AlertCircle, Building2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useSession } from '@/shared/hooks/useSession';
import { customerChanges, customerRole } from '../customerAccess';
import type { CustomerAddress, CustomerContact, CustomerDetails } from '@/lib/api/internal';
import { useCreateCustomer, useCustomerOptions, useSaveCustomerDetails } from '../hooks/useCustomerDetails';

type Props = {
  open: boolean;
  customer?: string;
  details?: CustomerDetails | null;
  onCreated?: (customer: CustomerDetails) => void;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const EMPTY_ADDRESS: CustomerAddress = {
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  country: '',
  phone: '',
  email_id: '',
};

const toOptions = (values: string[] = []) => values.map((value) => ({ value, label: value }));

const CustomerModal: React.FC<Props> = ({ open, customer, details, onClose, onCreated }) => {
  const { data: session } = useSession();
  const role = customerRole(session);
  const profileOnly = Boolean(customer) && role === 'MSP Customer Manager';
  const canEdit = customer
    ? (role === 'MSP System Admin' || role === 'MSP Customer Manager') && Boolean(details?.permissions?.can_edit)
    : role === 'MSP System Admin';
  const canEditAddress = !customer || Boolean(details?.permissions?.can_edit_address);
  const options = useCustomerOptions(open && canEdit);
  const save = useSaveCustomerDetails();
  const create = useCreateCustomer();
  const isCreate = !customer;
  const mutation = isCreate ? create : save;

  const [form, setForm] = useState<Partial<CustomerDetails>>({});
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [contactsChanged, setContactsChanged] = useState(false);
  const [address, setAddress] = useState<CustomerAddress>(EMPTY_ADDRESS);

  useEffect(() => {
    if (!open) return;
    setForm({ ...(details ?? { customer_type: 'Company' }) });
    setAddress({ ...EMPTY_ADDRESS, ...(details?.address ?? {}) });
    setContacts((details?.contacts ?? []).map((contact) => ({ ...contact })));
    setContactsChanged(false);
    save.reset();
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, details]);

  const set = (patch: Partial<CustomerDetails>) => setForm((current) => ({ ...current, ...patch }));
  const setAddr = (patch: Partial<CustomerAddress>) =>
    setAddress((current) => ({ ...current, ...patch }));

  const wantsAddress = Object.entries(address).some(
    ([key, value]) => key !== 'name' && Boolean(value?.trim())
  );
  const addressIncomplete = canEditAddress && wantsAddress && !(address.address_line1?.trim() && address.city?.trim() && address.country?.trim());
  const identityIncomplete = !profileOnly && (!form.customer_name?.trim() || (isCreate &&
    (!form.customer_type || !form.customer_group || !form.territory)));
  const contactsIncomplete = contactsChanged && contacts.some((contact) => contact.editable !== false && !contact.first_name?.trim());
  const close = () => { if (!mutation.isLoading) onClose(); };

  const submit = async () => {
    if (!canEdit || identityIncomplete || addressIncomplete || contactsIncomplete || mutation.isLoading) return;
    try {
      const { name: addressName, ...addressFields } = address;
      void addressName;
      const payload = {
        details: customerChanges(form, profileOnly),
        address: canEditAddress && wantsAddress ? addressFields : undefined,
      };
      if (customer) {
        await save.mutateAsync({
          customer, ...payload,
          contacts: contactsChanged ? contacts.filter((contact) => contact.editable !== false).map(({ editable, ...contact }) => {
            void editable;
            return contact;
          }) : undefined,
        });
      } else {
        const created = await create.mutateAsync(payload);
        onCreated?.(created);
      }
      onClose();
    } catch {
      // surfaced by the banner below
    }
  };

  return (
    <Modal
      open={open && canEdit}
      onClose={close}
      icon={Building2}
      tone="blue"
      title={isCreate ? 'Add Customer' : 'Customer details'}
      subtitle={isCreate ? 'Enter customer identity and optional billing details.' : profileOnly ? 'Keep your company contact information up to date.' : `${customer} — what appears on their invoices.`}
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canEdit || identityIncomplete || addressIncomplete || contactsIncomplete || mutation.isLoading || options.isLoading || options.isError}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              isCreate ? 'Create Customer' : 'Save'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {profileOnly ? (
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-900">{details?.customer_name}</p>
            <FieldLabel>Website</FieldLabel>
            <input type="text" value={form.website ?? ''} onChange={(event) => set({ website: event.target.value })} className={inputClass} />
          </div>
        ) : <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Identity
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <FieldLabel required>Name</FieldLabel>
              <input
                type="text"
                value={form.customer_name ?? ''}
                onChange={(event) => set({ customer_name: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel required={isCreate}>Type</FieldLabel>
              <Select
                className="w-full"
                value={form.customer_type ?? ''}
                onChange={(value) => set({ customer_type: value })}
                options={toOptions(options.data?.customer_types)}
              />
            </div>
            <div>
              <FieldLabel required={isCreate}>Group</FieldLabel>
              <Select
                className="w-full"
                value={form.customer_group ?? ''}
                onChange={(value) => set({ customer_group: value })}
                placeholder="No group"
                options={toOptions(options.data?.customer_groups)}
              />
            </div>
            <div>
              <FieldLabel required={isCreate}>Territory</FieldLabel>
              <Select
                className="w-full"
                value={form.territory ?? ''}
                onChange={(value) => set({ territory: value })}
                placeholder="No territory"
                options={toOptions(options.data?.territories)}
              />
            </div>
            <div>
              <FieldLabel>Tax ID</FieldLabel>
              <input
                type="text"
                value={form.tax_id ?? ''}
                onChange={(event) => set({ tax_id: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>Website</FieldLabel>
              <input
                type="text"
                value={form.website ?? ''}
                onChange={(event) => set({ website: event.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        </div>}

        <fieldset disabled={!canEditAddress} className="disabled:opacity-60">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Billing address
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <FieldLabel required={wantsAddress}>Address line 1</FieldLabel>
              <input
                type="text"
                value={address.address_line1 ?? ''}
                onChange={(event) => setAddr({ address_line1: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>Address line 2</FieldLabel>
              <input
                type="text"
                value={address.address_line2 ?? ''}
                onChange={(event) => setAddr({ address_line2: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel required={wantsAddress}>City</FieldLabel>
              <input
                type="text"
                value={address.city ?? ''}
                onChange={(event) => setAddr({ city: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>State</FieldLabel>
              <input
                type="text"
                value={address.state ?? ''}
                onChange={(event) => setAddr({ state: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>Postcode</FieldLabel>
              <input
                type="text"
                value={address.pincode ?? ''}
                onChange={(event) => setAddr({ pincode: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel required={wantsAddress}>Country</FieldLabel>
              <Select
                className="w-full"
                value={address.country ?? ''}
                onChange={(value) => setAddr({ country: value })}
                placeholder="Select a country"
                options={toOptions(options.data?.countries)}
                searchable
              />
            </div>
            <div>
              <FieldLabel>Phone</FieldLabel>
              <input
                type="text"
                value={address.phone ?? ''}
                onChange={(event) => setAddr({ phone: event.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>Email</FieldLabel>
              <input
                type="email"
                value={address.email_id ?? ''}
                onChange={(event) => setAddr({ email_id: event.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          {!canEditAddress && <p className="mt-2 text-sm text-slate-500">This address is shared. Ask your MSP administrator to arrange a separate address.</p>}
        </fieldset>

        {!isCreate && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Customer contacts</p>
            {contacts.map((contact, index) => (
              <fieldset key={contact.name ?? index} disabled={contact.editable === false} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 disabled:opacity-60">
                {(['first_name', 'last_name', 'email_id', 'phone'] as const).map((field) => (
                  <label key={field} className="text-sm text-slate-600">
                    {{ first_name: 'First name *', last_name: 'Last name', email_id: 'Email', phone: 'Phone' }[field]}
                    <input
                      type={field === 'email_id' ? 'email' : 'text'}
                      value={contact[field] ?? ''}
                      onChange={(event) => {
                        setContacts((current) => current.map((row, i) => i === index ? { ...row, [field]: event.target.value } : row));
                        setContactsChanged(true);
                      }}
                      className={inputClass}
                    />
                  </label>
                ))}
                {!contact.name && <button type="button" className="text-left text-sm text-red-600" onClick={() => {
                  setContacts((current) => current.filter((_, i) => i !== index));
                  setContactsChanged(true);
                }}>Remove new contact</button>}
                {contact.editable === false && <p className="text-xs text-slate-500 sm:col-span-2">Shared contact — editing is unavailable here.</p>}
              </fieldset>
            ))}
            <button type="button" className="text-sm font-semibold text-blue-600" onClick={() => {
              setContacts((current) => [...current, { first_name: '', last_name: '', email_id: '', phone: '' }]);
              setContactsChanged(true);
            }}>+ Add contact</button>
            {contactsIncomplete && <p className="text-sm text-amber-700">Each contact needs a first name.</p>}
          </div>
        )}

        {!profileOnly && <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Billing preferences
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <FieldLabel>Currency</FieldLabel>
              <Select
                className="w-full"
                value={form.default_currency ?? ''}
                onChange={(value) => set({ default_currency: value })}
                placeholder="Company default"
                options={toOptions(options.data?.currencies)}
              />
            </div>
            <div>
              <FieldLabel>Price list</FieldLabel>
              <Select
                className="w-full"
                value={form.default_price_list ?? ''}
                onChange={(value) => set({ default_price_list: value })}
                placeholder="From the contract"
                options={toOptions(options.data?.price_lists)}
              />
            </div>
            <div className="flex items-end pb-1 sm:col-span-2 lg:col-span-1">
              <label className="inline-flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.msp_free_of_charge)}
                  onChange={(event) => set({ msp_free_of_charge: event.target.checked ? 1 : 0 })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  Served free of charge
                  <span className="block text-xs text-slate-400">
                    Never billed — needs no contract and no rates.
                  </span>
                </span>
              </label>
            </div>
            <div>
              <FieldLabel>Payment terms</FieldLabel>
              <Select
                className="w-full"
                value={form.payment_terms ?? ''}
                onChange={(value) => set({ payment_terms: value })}
                placeholder="No terms"
                options={toOptions(options.data?.payment_terms)}
              />
            </div>
          </div>
        </div>}

        {options.isError && (
          <p className="text-sm text-red-700">Customer options could not be loaded. <button type="button" className="underline" onClick={() => options.refetch()}>Retry</button></p>
        )}
        {identityIncomplete && (
          <p className="text-sm font-medium text-amber-700">
            {isCreate ? 'Name, type, group, and territory are required.' : 'Customer name is required.'}
          </p>
        )}
        {addressIncomplete && (
          <p className="text-sm font-medium text-amber-700">
            An address needs a first line, city, and country.
          </p>
        )}

        {mutation.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{mutation.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CustomerModal;
