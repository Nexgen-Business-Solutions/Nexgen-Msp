import React, { useEffect, useState } from 'react';
import { AlertCircle, FileSignature } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import MultiSelect from '@/shared/components/MultiSelect';
import type { MspContract, MspContractDetail } from '@/lib/api/internal';
import { useMspContractOptions, useSaveMspContract } from '../hooks/useMspContracts';

type Props = {
  open: boolean;
  customer: string;
  contract: MspContractDetail | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const EMPTY: Partial<MspContract> = {
  title: '',
  status: 'Active',
  start_date: '',
  end_date: null,
  billing_frequency: 'Quarterly',
  billing_timing: 'In Arrears',
  proration_method: 'Daily Actual Days',
  invoice_grouping: 'One Invoice',
  price_list: undefined,
  price_list_valid_upto: null,
  currency: undefined,
  billing_notes: null,
};

const today = () => new Date().toISOString().slice(0, 10);

const toOptions = (values: string[] = []) => values.map((value) => ({ value, label: value }));

const MspContractModal: React.FC<Props> = ({ open, customer, contract, onClose }) => {
  const options = useMspContractOptions(customer);
  const save = useSaveMspContract();

  const [draft, setDraft] = useState<Partial<MspContract>>(EMPTY);
  const [services, setServices] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;

    setDraft({
      ...EMPTY,
      // a new agreement starts the day it is signed unless told otherwise
      start_date: contract?.start_date ?? today(),
      ...(contract ?? {}),
      customer,
      price_list: contract?.price_list ?? options.data?.default_price_list ?? undefined,
      // the company's own currency, not whatever comes first alphabetically
      currency: contract?.currency ?? options.data?.default_currency ?? undefined,
    });
    setServices((contract?.services ?? []).map((row) => row.service_item));
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract, options.data]);

  const set = (patch: Partial<MspContract>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    try {
      await save.mutateAsync({
        name: contract?.name,
        contract: { ...draft, customer },
        services: services.map((service_item) => ({ service_item })),
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
      icon={FileSignature}
      tone="blue"
      title={contract ? 'Edit the contract' : 'New contract'}
      subtitle={`${customer} — one contract produces one invoice.`}
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
            disabled={!draft.title?.trim() || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save contract'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <FieldLabel required>Title</FieldLabel>
            <input
              type="text"
              value={draft.title ?? ''}
              onChange={(event) => set({ title: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel required>Status</FieldLabel>
            <Select
              className="w-full"
              value={draft.status ?? ''}
              onChange={(value) => set({ status: value })}
              options={toOptions(options.data?.statuses)}
            />
          </div>
          <div>
            <FieldLabel required>Billing frequency</FieldLabel>
            <Select
              className="w-full"
              value={draft.billing_frequency ?? ''}
              onChange={(value) => set({ billing_frequency: value })}
              options={toOptions(options.data?.billing_frequencies)}
            />
          </div>
          <div>
            <FieldLabel required>Start date</FieldLabel>
            <input
              type="date"
              value={(draft.start_date ?? '').slice(0, 10)}
              onChange={(event) => set({ start_date: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>End date</FieldLabel>
            <input
              type="date"
              value={(draft.end_date ?? '').slice(0, 10)}
              onChange={(event) => set({ end_date: event.target.value || null })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel required>Billing timing</FieldLabel>
            <Select
              className="w-full"
              value={draft.billing_timing ?? ''}
              onChange={(value) => set({ billing_timing: value })}
              options={toOptions(options.data?.billing_timings)}
            />
          </div>
          <div>
            <FieldLabel required>Proration</FieldLabel>
            <Select
              className="w-full"
              value={draft.proration_method ?? ''}
              onChange={(value) => set({ proration_method: value })}
              options={toOptions(options.data?.proration_methods)}
            />
          </div>
          <div>
            <FieldLabel required>Invoice grouping</FieldLabel>
            <Select
              className="w-full"
              value={draft.invoice_grouping ?? ''}
              onChange={(value) => set({ invoice_grouping: value })}
              options={toOptions(options.data?.invoice_groupings)}
            />
          </div>
          <div>
            <FieldLabel required>Price list</FieldLabel>
            <Select
              className="w-full"
              value={draft.price_list ?? ''}
              onChange={(value) => set({ price_list: value })}
              placeholder="Select a price list"
              options={toOptions(options.data?.price_lists)}
              searchable
            />
          </div>
          <div>
            <FieldLabel>Price list valid upto</FieldLabel>
            <input
              type="date"
              value={(draft.price_list_valid_upto ?? '').slice(0, 10)}
              onChange={(event) => set({ price_list_valid_upto: event.target.value || null })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel required>Currency</FieldLabel>
            <Select
              className="w-full"
              value={draft.currency ?? ''}
              onChange={(value) => set({ currency: value })}
              placeholder="Select a currency"
              options={toOptions(options.data?.currencies)}
              searchable
            />
          </div>
        </div>

        <div>
          <FieldLabel required>Services covered</FieldLabel>
          <MultiSelect
            values={services}
            onChange={setServices}
            options={options.data?.services ?? []}
            placeholder="Select the services this contract covers"
          />
        </div>

        <div>
          <FieldLabel>Billing notes</FieldLabel>
          <textarea
            rows={3}
            value={draft.billing_notes ?? ''}
            onChange={(event) => set({ billing_notes: event.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

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

export default MspContractModal;
