import React, { useEffect, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useCustomerUsers, useReinstateDevice } from '../hooks/useDevices';

type Props = {
  open: boolean;
  device: string;
  hostname: string;
  serialNumber?: string | null;
  customer: string;
  onClose: () => void;
  onDone?: () => void;
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

type Mode = 'stock' | 'assign';

const ReinstateDeviceModal: React.FC<Props> = ({
  open,
  device,
  hostname,
  serialNumber,
  customer,
  onClose,
  onDone,
}) => {
  const users = useCustomerUsers(customer);
  const reinstate = useReinstateDevice();

  const [mode, setMode] = useState<Mode>('stock');
  const [holder, setHolder] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('stock');
    setHolder('');
    setEffectiveDate(today());
    setNote('');
    reinstate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const canSubmit = effectiveDate && (mode === 'stock' || Boolean(holder));

  const submit = async () => {
    try {
      await reinstate.mutateAsync({
        device,
        effective_date: effectiveDate,
        client_user: mode === 'assign' ? holder : undefined,
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
      icon={RotateCcw}
      tone="blue"
      title="Reinstate this device"
      subtitle="Bring it back into service."
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
            disabled={!canSubmit || reinstate.isLoading}
            className="flex min-w-[9rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reinstate.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : mode === 'assign' ? (
              'Reinstate and assign'
            ) : (
              'Return to stock'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{hostname}</p>
          {serialNumber && <p className="mt-0.5 text-xs text-slate-500">{serialNumber}</p>}
        </div>

        <div>
          <span className={labelClass}>Reinstate as</span>
          <div className="inline-flex rounded-lg bg-slate-200/70 p-1">
            <button
              type="button"
              onClick={() => setMode('stock')}
              className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
                mode === 'stock' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              Return to stock
            </button>
            <button
              type="button"
              onClick={() => setMode('assign')}
              className={`rounded-md px-3 py-2.5 text-xs font-semibold transition-all ${
                mode === 'assign' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              Assign immediately to
            </button>
          </div>
        </div>

        {mode === 'assign' && (
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
        )}

        <p className="text-xs text-slate-500">
          Previously ended services will NOT be restarted automatically.
        </p>

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

        {reinstate.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{reinstate.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ReinstateDeviceModal;
