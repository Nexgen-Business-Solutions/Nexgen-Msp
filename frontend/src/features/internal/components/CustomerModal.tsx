import React, { useEffect, useState } from 'react';
import { AlertCircle, Building2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { CustomerAddress, CustomerDetails } from '@/lib/api/internal';
import { useCustomerOptions, useSaveCustomerDetails } from '../hooks/useCustomerDetails';

type Props = {
  open: boolean;
  customer: string;
  details: CustomerDetails | null;
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

const CustomerModal: React.FC<Props> = ({ open, customer, details, onClose }) => {
  const options = useCustomerOptions();
  const save = useSaveCustomerDetails();

  const [form, setForm] = useState<Partial<CustomerDetails>>({});
  const [address, setAddress] = useState<CustomerAddress>(EMPTY_ADDRESS);

  useEffect(() => {
    if (!open) return;
    setForm({ ...(details ?? {}) });
    setAddress({ ...EMPTY_ADDRESS, ...(details?.address ?? {}) });
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, details]);

  const set = (patch: Partial<CustomerDetails>) => setForm((current) => ({ ...current, ...patch }));
  const setAddr = (patch: Partial<CustomerAddress>) =>
    setAddress((current) => ({ ...current, ...patch }));

  const wantsAddress = Boolean(
    address.address_line1 || address.city || address.country || address.phone || address.email_id
  );
  const addressIncomplete = wantsAddress && !(address.address_line1 && address.country);

  const submit = async () => {
    try {
      await save.mutateAsync({
        customer,
        details: form,
        address: wantsAddress ? address : undefined,
      });
      onClose();
    } catch {
      // surfaced by the banner below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Building2}
      tone="blue"
      title="Customer details"
      subtitle={`${customer} — what appears on their invoices.`}
      widthClass="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={addressIncomplete || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
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
              <FieldLabel>Type</FieldLabel>
              <Select
                className="w-full"
                value={form.customer_type ?? ''}
                onChange={(value) => set({ customer_type: value })}
                options={toOptions(options.data?.customer_types)}
              />
            </div>
            <div>
              <FieldLabel>Group</FieldLabel>
              <Select
                className="w-full"
                value={form.customer_group ?? ''}
                onChange={(value) => set({ customer_group: value })}
                placeholder="No group"
                options={toOptions(options.data?.customer_groups)}
              />
            </div>
            <div>
              <FieldLabel>Territory</FieldLabel>
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
        </div>

        <div>
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
              <FieldLabel>City</FieldLabel>
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
        </div>

        <div>
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
        </div>

        {addressIncomplete && (
          <p className="text-sm font-medium text-amber-700">
            An address needs at least a first line and a country.
          </p>
        )}

        {save.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CustomerModal;
