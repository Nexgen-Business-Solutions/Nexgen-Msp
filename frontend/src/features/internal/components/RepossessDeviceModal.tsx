import React, { useEffect, useState } from 'react';
import { AlertCircle, Undo2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { today } from '@/shared/lib/today';
import { useRepossessDevice } from '../hooks/useDevices';

type Props = {
  open: boolean;
  device: string;
  hostname: string;
  serialNumber?: string | null;
  currentHolder?: string | null;
  currentHolderName?: string | null;
  onClose: () => void;
  onDone?: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500';

const RepossessDeviceModal: React.FC<Props> = ({
  open,
  device,
  hostname,
  serialNumber,
  currentHolder,
  currentHolderName,
  onClose,
  onDone,
}) => {
  const repossess = useRepossessDevice();

  const [effectiveDate, setEffectiveDate] = useState(today());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setEffectiveDate(today());
    setNote('');
    repossess.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    try {
      await repossess.mutateAsync({
        device,
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
      icon={Undo2}
      tone="indigo"
      title="Return device to stock"
      subtitle="Closes the current holder period. The device goes back to stock."
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
            disabled={!effectiveDate || repossess.isLoading}
            className="flex min-w-[9rem] items-center justify-center rounded-full bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {repossess.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Return to stock'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50/70 ring-1 ring-slate-200/60 p-3">
          <p className="text-sm font-semibold text-slate-900">{hostname}</p>
          {serialNumber && <p className="mt-0.5 text-xs text-slate-500">{serialNumber}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-400">FROM</p>
            <p className="mt-0.5 text-sm text-slate-700">
              {currentHolderName || currentHolder || 'Nobody'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">DESTINATION</p>
            <p className="mt-0.5 text-sm text-slate-700">Available stock</p>
          </div>
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

        <p className="text-xs text-slate-500">Device services will remain unchanged.</p>

        {repossess.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-xl bg-red-50 ring-1 ring-red-100 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{repossess.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RepossessDeviceModal;
