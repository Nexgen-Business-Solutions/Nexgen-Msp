import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleX } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { useStopAllServices } from '../hooks/useUsers';

type Props = {
  person: { name: string; full_name: string } | null;
  sourceRequest?: string;
  onClose: () => void;
  onDone?: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

/** Every personal service of one person, closed from one day. Their machines keep their own. */
const StopAllServicesModal: React.FC<Props> = ({ person, sourceRequest, onClose, onDone }) => {
  const stop = useStopAllServices();
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!person) return;
    setDate(today());
    setNote('');
    stop.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person]);

  const submit = async () => {
    if (!person) return;
    try {
      await stop.mutateAsync({
        name: person.name,
        effective_date: date,
        notes: note.trim() || undefined,
        source_request: sourceRequest,
      });
      onClose();
      onDone?.();
    } catch {
      // shown below
    }
  };

  return (
    <Modal
      open={Boolean(person)}
      onClose={onClose}
      icon={CircleX}
      tone="red"
      title={`Stop all services of ${person?.full_name ?? ''}?`}
      subtitle="Every personal service closes on the date you choose. Services on their machines stay with the machines."
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!date || stop.isLoading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {stop.isLoading ? 'Stopping…' : 'Stop all services'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required>Close on</FieldLabel>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Close on" className={inputClass} />
        </div>
        <div>
          <FieldLabel>Note</FieldLabel>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional"
            aria-label="Note"
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>
        {stop.error instanceof Error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {stop.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default StopAllServicesModal;
