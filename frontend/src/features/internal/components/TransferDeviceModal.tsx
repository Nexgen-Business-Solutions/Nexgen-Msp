import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRightLeft } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { today } from '@/shared/lib/today';
import { useCustomerUsers, useTransferDevice } from '../hooks/useDevices';

type Props = {
  open: boolean;
  device: string;
  hostname: string;
  serialNumber?: string | null;
  customer: string;
  currentHolder?: string | null;
  currentHolderName?: string | null;
  heldSince?: string | null;
  onClose: () => void;
  onDone?: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500';

const TransferDeviceModal: React.FC<Props> = ({
  open,
  device,
  hostname,
  serialNumber,
  customer,
  currentHolder,
  currentHolderName,
  heldSince,
  onClose,
  onDone,
}) => {
  const users = useCustomerUsers(customer);
  const transfer = useTransferDevice();

  const [holder, setHolder] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setHolder('');
    setEffectiveDate(today());
    setNote('');
    transfer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    try {
      await transfer.mutateAsync({
        device,
        client_user: holder,
        effective_date: effectiveDate,
        note: note.trim() || undefined,
      });
      onClose();
      onDone?.();
    } catch {
      // surfaced by the error banner below
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={ArrowRightLeft}
      tone="blue"
      title="Transfer this device"
      subtitle="Closes the current holder period and opens the new one the same day."
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!holder || !effectiveDate || transfer.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {transfer.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Transfer'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50/70 ring-1 ring-slate-200/60 p-3">
          <p className="text-sm font-semibold text-slate-900">{hostname}</p>
          {serialNumber && <p className="mt-0.5 text-xs text-slate-500">{serialNumber}</p>}
          <p className="mt-1 text-xs font-semibold text-slate-400">CURRENT HOLDER</p>
          <p className="text-sm text-slate-700">
            {currentHolderName || currentHolder || 'Nobody'}
            {heldSince ? ` · since ${heldSince.slice(0, 10)}` : ''}
          </p>
        </div>

        <div>
          <FieldLabel required>Transfer to</FieldLabel>
          <Select
            className="w-full"
            value={holder}
            onChange={setHolder}
            placeholder="Choose who takes it"
            options={(users.data ?? [])
              .filter((item) => item.name !== currentHolder)
              .map((item) => ({
                value: item.name,
                label: item.full_name,
                description: item.department ?? undefined,
              }))}
          />
        </div>

        <div>
          <FieldLabel required>Effective date</FieldLabel>
          <input
            type="date"
            value={effectiveDate}
            max={today()}
            onChange={(event) => setEffectiveDate(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <span className={labelClass}>Internal note</span>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why it changed hands — kept for Nexgen, not shown to the customer."
            className="w-full resize-y py-3 leading-relaxed placeholder:text-slate-400 rounded-xl border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {transfer.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-xl bg-red-50 ring-1 ring-red-100 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{transfer.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TransferDeviceModal;
