import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleCheck } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { InvoiceSettings } from '@/lib/api/internal';
import { useInvoiceSettings, useSaveInvoiceSettings } from '../hooks/useSettings';
import { useInvoiceDimensions } from '../hooks/useBilling';

const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

const areaClass =
  'w-full rounded-xl border-0 bg-slate-100/80 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

/** One block of settings: what it is on the left, its fields on the right. */
const Group = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-6 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{description}</p>
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

const EMPTY: InvoiceSettings = {
  issuer_name: '',
  issuer_address: '',
  issuer_phone: '',
  issuer_website: '',
  bank_currency: '',
  beneficiary: '',
  beneficiary_bank: '',
  intermediary_bank: '',
  footer_note: '',
  payment_terms_days: 30,
  dispute_window_days: 10,
  default_cost_center: '',
  show_cost_center_on_invoice: 0,
};

/** Each block prints one line per line typed, so the layout follows what is entered. */
const InvoiceSettingsForm: React.FC = () => {
  const settings = useInvoiceSettings();
  const save = useSaveInvoiceSettings();
  const dimensions = useInvoiceDimensions();

  const [form, setForm] = useState<InvoiceSettings>(EMPTY);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setForm({ ...EMPTY, ...settings.data });
    setDirty(false);
  }, [settings.data]);

  const set = (patch: Partial<InvoiceSettings>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const submit = async () => {
    try {
      await save.mutateAsync(form);
      setDirty(false);
    } catch {
      // surfaced below
    }
  };

  if (settings.isLoading) {
    return <p className="px-5 py-12 text-center text-sm text-slate-500" aria-busy="true">Loading…</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      <Group
        title="Issuer"
        description="Who the invoice is from, printed at its top."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <FieldLabel required>Name</FieldLabel>
            <input
              type="text"
              value={form.issuer_name ?? ''}
              onChange={(event) => set({ issuer_name: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Phone</FieldLabel>
            <input
              type="text"
              value={form.issuer_phone ?? ''}
              onChange={(event) => set({ issuer_phone: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Website</FieldLabel>
            <input
              type="text"
              value={form.issuer_website ?? ''}
              onChange={(event) => set({ issuer_website: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Address</FieldLabel>
            <textarea
              rows={3}
              value={form.issuer_address ?? ''}
              onChange={(event) => set({ issuer_address: event.target.value })}
              className={areaClass}
            />
          </div>
        </div>
      </Group>

      <Group
        title="Bank details for wire transfer"
        description="What the customer needs to pay by wire. Each line typed prints as a line."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 2xl:grid-cols-3">
          <div className="sm:col-span-2 sm:max-w-[12rem] 2xl:col-span-3">
            <FieldLabel>Wire currency</FieldLabel>
            <input
              type="text"
              value={form.bank_currency ?? ''}
              onChange={(event) => set({ bank_currency: event.target.value })}
              placeholder="USD"
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Beneficiary</FieldLabel>
            <textarea
              rows={6}
              value={form.beneficiary ?? ''}
              onChange={(event) => set({ beneficiary: event.target.value })}
              className={areaClass}
            />
          </div>
          <div>
            <FieldLabel>Beneficiary bank</FieldLabel>
            <textarea
              rows={6}
              value={form.beneficiary_bank ?? ''}
              onChange={(event) => set({ beneficiary_bank: event.target.value })}
              className={areaClass}
            />
          </div>
          <div>
            <FieldLabel>Intermediary bank</FieldLabel>
            <textarea
              rows={6}
              value={form.intermediary_bank ?? ''}
              onChange={(event) => set({ intermediary_bank: event.target.value })}
              className={areaClass}
            />
          </div>
        </div>
      </Group>

      <Group
        title="Footer"
        description="A closing line under every invoice."
      >
        <div className="sm:max-w-md">
          <FieldLabel>Closing line</FieldLabel>
          <input
            type="text"
            value={form.footer_note ?? ''}
            onChange={(event) => set({ footer_note: event.target.value })}
            className={inputClass}
          />
        </div>
      </Group>

      <Group
        title="Accounting"
        description="Where each invoice is booked."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <FieldLabel required>Default cost center</FieldLabel>
            <Select
              searchable
              className="w-full"
              value={form.default_cost_center ?? ''}
              onChange={(value) => set({ default_cost_center: value })}
              placeholder="Pick one"
              options={(dimensions.data ?? [])
                .find((entry) => entry.fieldname === 'cost_center')
                ?.options.map((option) => ({ value: option, label: option })) ?? []}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Every invoice is booked against it, on the invoice and on each of its lines.
            </p>
          </div>
          <div>
            <FieldLabel>Shown to the customer</FieldLabel>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={Boolean(form.show_cost_center_on_invoice)}
                onChange={(event) =>
                  set({ show_cost_center_on_invoice: event.target.checked ? 1 : 0 })
                }
                className="h-4 w-4 rounded border-slate-300 accent-blue-500"
              />
              <span className="text-sm text-slate-700">Print the cost center on the invoice</span>
            </label>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Off by default: it is an internal accounting axis, not something the customer
              needs to read.
            </p>
          </div>
        </div>
      </Group>

      <Group
        title="Terms"
        description="When an invoice falls due, and how long it can be contested."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:max-w-2xl sm:grid-cols-2">
          <div>
            <FieldLabel required>Days to pay</FieldLabel>
            <input
              type="number"
              min={0}
              value={form.payment_terms_days ?? 30}
              onChange={(event) => set({ payment_terms_days: Number(event.target.value) })}
              className={inputClass}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Counted from the invoice date. At zero, an invoice is overdue the next day.
            </p>
          </div>
          <div>
            <FieldLabel required>Days to contest</FieldLabel>
            <input
              type="number"
              min={1}
              value={form.dispute_window_days ?? 10}
              onChange={(event) => set({ dispute_window_days: Number(event.target.value) })}
              className={inputClass}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Past it, the customer no longer dispute the invoice.
            </p>
          </div>
        </div>
      </Group>

      {save.error instanceof Error && (
        <div className="px-5 py-4 sm:px-6">
          <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 rounded-b-2xl bg-slate-50/60 px-5 py-4 sm:px-6">
        {!dirty && save.isSuccess && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
            <CircleCheck size={15} />
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || !form.issuer_name?.trim() || save.isLoading}
          className="flex min-w-[7rem] items-center justify-center rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {save.isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            'Save'
          )}
        </button>
      </div>
    </div>
  );
};

export default InvoiceSettingsForm;
