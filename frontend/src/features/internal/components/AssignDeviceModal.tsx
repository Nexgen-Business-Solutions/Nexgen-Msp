import React, { useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { today } from '@/shared/lib/today';
import { useAssignDevice, useCustomerUsers } from '../hooks/useDevices';

type Props = {
  open: boolean;
  device: string;
  hostname: string;
  serialNumber?: string | null;
  status: string;
  customer: string;
  onClose: () => void;
  onDone?: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500';

const AssignDeviceModal: React.FC<Props> = ({
  open,
  device,
  hostname,
  serialNumber,
  status,
  customer,
  onClose,
  onDone,
}) => {
  const users = useCustomerUsers(customer);
  const assign = useAssignDevice();

  const [holder, setHolder] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setHolder('');
    setEffectiveDate(today());
    setNote('');
    assign.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    try {
      await assign.mutateAsync({
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
      icon={UserPlus}
      tone="blue"
      title="Assign to user"
      subtitle="Opens a new holder period for this device."
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
            disabled={!holder || !effectiveDate || assign.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {assign.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Assign'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50/70 ring-1 ring-slate-200/60 p-3">
          <p className="text-sm font-semibold text-slate-900">{hostname}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {serialNumber ? `${serialNumber} · ` : ''}
            Status: {status}
          </p>
        </div>

        <div>
          <FieldLabel required>Assign to</FieldLabel>
          <Select
            className="w-full"
            value={holder}
            onChange={setHolder}
            placeholder="Choose who takes it"
            options={(users.data ?? []).map((item) => ({
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
            placeholder="Kept for Nexgen, not shown to the customer."
            className="w-full resize-y py-3 leading-relaxed placeholder:text-slate-400 rounded-xl border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {assign.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-xl bg-red-50 ring-1 ring-red-100 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{assign.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AssignDeviceModal;
