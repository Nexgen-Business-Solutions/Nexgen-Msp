import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRightLeft } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useCustomerUsers, useHandOverDevice } from '../hooks/useDevices';

type Props = {
  open: boolean;
  device: string;
  hostname: string;
  customer: string;
  currentHolder?: string | null;
  currentHolderName?: string | null;
  heldSince?: string | null;
  onClose: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const HandOverModal: React.FC<Props> = ({
  open,
  device,
  hostname,
  customer,
  currentHolder,
  currentHolderName,
  heldSince,
  onClose,
}) => {
  const users = useCustomerUsers(customer);
  const handOver = useHandOverDevice();

  const [holder, setHolder] = useState('');
  const [onDate, setOnDate] = useState(today());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setHolder('');
    setOnDate(today());
    setNote('');
    handOver.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    try {
      await handOver.mutateAsync({
        device,
        client_user: holder || undefined,
        on_date: onDate,
        note: note.trim() || undefined,
      });
      onClose();
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
      title="Hand this device over"
      subtitle="The day it actually changed hands, not the day you record it."
      widthClass="max-w-lg"
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
            disabled={!onDate || holder === (currentHolder ?? '') || handOver.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {handOver.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Hand over'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{hostname}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {currentHolder
              ? `Held by ${currentHolderName || currentHolder}${
                  heldSince ? ` since ${heldSince.slice(0, 10)}` : ''
                }`
              : 'Nobody holds it today'}
          </p>
        </div>

        <div>
          <FieldLabel required>Hand over to</FieldLabel>
          <Select
            className="w-full"
            value={holder}
            onChange={setHolder}
            placeholder="Choose who takes it"
            options={[
              { value: '', label: 'Nobody', description: 'The device goes back to the shelf' },
              ...(users.data ?? [])
                .filter((item) => item.name !== currentHolder)
                .map((item) => ({
                  value: item.name,
                  label: item.full_name,
                  description: item.department ?? undefined,
                })),
            ]}
          />
        </div>

        <div>
          <FieldLabel required>Hand-over date</FieldLabel>
          <input
            type="date"
            value={onDate}
            max={today()}
            onChange={(event) => setOnDate(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-slate-400">
            Today by default. Set it back if the device changed hands earlier.
          </p>
        </div>

        <div>
          <span className={labelClass}>Internal note</span>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why it changed hands — kept for Nexgen, not shown to the customer."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {handOver.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{handOver.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default HandOverModal;
