import React, { useEffect, useState } from 'react';
import { AlertCircle, FileSignature } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { ContractProfile } from '@/lib/api/internal';
import { useContractOptions, useSaveContract } from '../hooks/useContracts';

type Props = {
  open: boolean;
  customer: string;
  profile: ContractProfile | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const EMPTY: ContractProfile = {
  contract_status: 'Active',
  contract_start_date: null,
  contract_end_date: null,
  billing_frequency: 'Monthly',
  billing_timing: 'In Arrears',
  proration_method: 'Daily Actual Days',
  invoice_grouping: 'One Invoice',
  customer_approval_required: 0,
  price_list: null,
  price_list_valid_upto: null,
  currency: null,
  default_cost_center: null,
  billing_notes: null,
};

const toOptions = (values: string[] = []) => values.map((value) => ({ value, label: value }));

const ContractModal: React.FC<Props> = ({ open, customer, profile, onClose }) => {
  const options = useContractOptions();
  const save = useSaveContract();

  const [draft, setDraft] = useState<ContractProfile>(EMPTY);

  useEffect(() => {
    if (!open) return;
    setDraft({
      ...EMPTY,
      ...(profile ?? {}),
      currency: profile?.currency ?? options.data?.company_currency ?? null,
      price_list: profile?.price_list ?? options.data?.price_lists?.[0] ?? null,
    });
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile, options.data]);

  const set = (patch: Partial<ContractProfile>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    try {
      await save.mutateAsync({ customer, profile: draft, services: [] });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={FileSignature}
      tone="blue"
      title={profile ? 'Edit the contract' : 'Set up the contract'}
      subtitle={`${customer} — terms that govern how the services are billed.`}
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
            disabled={save.isLoading}
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
          <div>
            <FieldLabel required>Status</FieldLabel>
            <Select
              className="w-full"
              value={draft.contract_status ?? ''}
              onChange={(value) => set({ contract_status: value })}
              options={toOptions(options.data?.contract_statuses)}
            />
          </div>
          <div>
            <FieldLabel required>Start date</FieldLabel>
            <input
              type="date"
              value={(draft.contract_start_date ?? '').slice(0, 10)}
              onChange={(event) => set({ contract_start_date: event.target.value || null })}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>End date</FieldLabel>
            <input
              type="date"
              value={(draft.contract_end_date ?? '').slice(0, 10)}
              onChange={(event) => set({ contract_end_date: event.target.value || null })}
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

        {draft.currency &&
          options.data?.company_currency &&
          draft.currency !== options.data.company_currency && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <span className="text-sm text-amber-800">
                {options.data.company} keeps its books in {options.data.company_currency}. Billing in{' '}
                {draft.currency} will require a Currency Exchange record.
              </span>
            </div>
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

export default ContractModal;
