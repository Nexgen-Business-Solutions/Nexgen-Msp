import React, { useEffect, useState } from 'react';
import { AlertCircle, Coins } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { ContractRate, ContractServiceRow } from '@/lib/api/internal';
import { useSaveRate } from '../hooks/useContracts';

type Props = {
  open: boolean;
  customer: string;
  currency: string | null;
  services: ContractServiceRow[];
  editing: ContractRate | null;
  presetService?: string;
  contractWindow?: { start_date: string; end_date: string | null } | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

const RateModal: React.FC<Props> = ({
  open,
  customer,
  currency,
  services,
  editing,
  presetService,
  contractWindow,
  onClose,
}) => {
  const save = useSaveRate(customer);

  const [service, setService] = useState('');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUpto, setValidUpto] = useState('');
  const [note, setNote] = useState('');
  const [discount, setDiscount] = useState('');

  const datesInverted = Boolean(validFrom && validUpto && validUpto < validFrom);

  useEffect(() => {
    if (!open) return;
    setService(editing?.item_code ?? presetService ?? '');
    setRate(editing ? String(editing.price_list_rate) : '');
    setDiscount(editing?.msp_discount_percent ? String(editing.msp_discount_percent) : '');
    // a new rate holds for as long as the agreement it prices
    setValidFrom((editing?.valid_from ?? (editing ? '' : contractWindow?.start_date) ?? '').slice(0, 10));
    setValidUpto((editing?.valid_upto ?? (editing ? '' : contractWindow?.end_date) ?? '').slice(0, 10));
    setNote(editing?.note ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, presetService, contractWindow]);

  const submit = async () => {
    try {
      await save.mutateAsync({
        customer,
        service_item: service,
        rate: Number(rate),
        valid_from: validFrom || undefined,
        valid_upto: validUpto || undefined,
        discount_percent: Number(discount || 0),
        note: note.trim() || undefined,
        name: editing?.name,
      });
      onClose();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Coins}
      tone="emerald"
      title={editing ? 'Correct this rate' : 'New rate'}
      subtitle={
        editing
          ? 'Fix a mistake on this version. To change price, add a new one instead.'
          : 'A new version. The previous rate stays, so past periods keep billing correctly.'
      }
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!service || !rate || Number(rate) <= 0 || datesInverted || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save rate'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required>Service</FieldLabel>
          <Select
            searchable
            className="w-full"
            value={service}
            onChange={setService}
            placeholder="Select a service"
            options={services.map((item) => ({
              value: item.service_item,
              label: item.service_name,
              description: item.is_eligible ? undefined : 'Not offered to this customer yet',
            }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel required>Rate {currency ? `(${currency})` : ''}</FieldLabel>
            <input
              aria-label="Rate"
              type="number"
              min={0}
              step="0.01"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              placeholder="0.00"
              className={`${inputClass} text-right tabular-nums`}
            />
          </div>
          <div>
            <FieldLabel>Discount</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                placeholder="0"
                className={`${inputClass} text-right tabular-nums`}
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
          <div>
            <FieldLabel>Applies from</FieldLabel>
            <input
              aria-label="Applies from"
              type="date"
              value={validFrom}
              max={validUpto || undefined}
              onChange={(event) => setValidFrom(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Applies until</FieldLabel>
            <input
              type="date"
              value={validUpto}
              min={validFrom || undefined}
              onChange={(event) => setValidUpto(event.target.value)}
              className={`${inputClass} ${datesInverted ? 'ring-2 ring-red-300 focus:ring-red-500' : ''}`}
            />
          </div>
        </div>

        {datesInverted && (
          <p className="text-sm font-medium text-red-600">
            The end date falls before the start date.
          </p>
        )}

        <div>
          <FieldLabel>Note</FieldLabel>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="2026 increase, agreed by email"
            className="w-full resize-y rounded-xl border-0 bg-slate-100/80 px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {save.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RateModal;
