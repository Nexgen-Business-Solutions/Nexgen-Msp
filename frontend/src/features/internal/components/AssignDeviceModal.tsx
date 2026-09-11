import React, { useEffect, useState } from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
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
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

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
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!holder || !effectiveDate || assign.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
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
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {assign.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{assign.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AssignDeviceModal;
