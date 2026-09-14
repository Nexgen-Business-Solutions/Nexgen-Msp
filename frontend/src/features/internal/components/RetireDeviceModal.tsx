import React, { useEffect, useState } from 'react';
import { AlertCircle, PowerOff } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { useRetireDevice } from '../hooks/useDevices';

type Props = {
  open: boolean;
  device: string;
  hostname: string;
  serialNumber?: string | null;
  currentHolder?: string | null;
  currentHolderName?: string | null;
  openServiceCount?: number;
  onClose: () => void;
  onDone?: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-red-500 focus:ring-4 focus:ring-red-100';

const today = () => new Date().toISOString().slice(0, 10);

const RetireDeviceModal: React.FC<Props> = ({
  open,
  device,
  hostname,
  serialNumber,
  currentHolder,
  currentHolderName,
  openServiceCount = 0,
  onClose,
  onDone,
}) => {
  const retire = useRetireDevice();

  const [effectiveDate, setEffectiveDate] = useState(today());
  const [note, setNote] = useState('');
  const [endServices, setEndServices] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEffectiveDate(today());
    setNote('');
    setEndServices(false);
    retire.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    try {
      await retire.mutateAsync({
        device,
        effective_date: effectiveDate,
        note: note.trim() || undefined,
        end_services: endServices ? 1 : 0,
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
      icon={PowerOff}
      tone="red"
      title="Retire this device?"
      subtitle="It leaves the fleet for good. This is not easily undone."
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
            disabled={!effectiveDate || retire.isLoading}
            className="flex min-w-[9rem] items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retire.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Retire device'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{hostname}</p>
          {serialNumber && <p className="mt-0.5 text-xs text-slate-500">{serialNumber}</p>}
          <p className="mt-1 text-xs text-slate-500">
            Current holder: {currentHolderName || currentHolder || 'Nobody'}
          </p>
        </div>

        {openServiceCount > 0 ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <input
              type="checkbox"
              checked={endServices}
              onChange={(event) => setEndServices(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-red-300 text-red-600"
            />
            <span>
              <span className="block font-semibold">Also end this device's open services</span>
              <span className="mt-0.5 block text-xs text-red-700">
                {openServiceCount} open service{openServiceCount === 1 ? '' : 's'} will be ended.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm font-medium text-slate-700">No open device services.</p>
        )}

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
          <span className={labelClass}>Reason / internal note</span>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why it's retired — kept for Nexgen, not shown to the customer."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-red-500 focus:ring-4 focus:ring-red-100"
          />
        </div>

        {retire.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{retire.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RetireDeviceModal;
