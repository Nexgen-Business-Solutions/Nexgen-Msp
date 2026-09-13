import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import { useAddTechnicianAction, useTechnicianOptions } from '../../hooks/useRequests';

type Props = {
  request: string;
  subject: { key: string; name: string } | null;
  onClose: () => void;
};

/**
 * Other work the job on the ground calls for. The choices come from the server, read from what
 * the person and their machines hold today; nothing here is a list kept by the screen.
 */
const MoreActionsModal: React.FC<Props> = ({ request, subject, onClose }) => {
  const options = useTechnicianOptions(request, subject?.key ?? null);
  const add = useAddTechnicianAction();
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!subject) return;
    setPicked(null);
    setReason('');
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const rows = options.data?.options ?? [];
  const chosen = rows.find((row) => row.key === picked);

  const submit = async () => {
    if (!subject || !chosen || !reason.trim()) return;
    try {
      await add.mutateAsync({ name: request, subject_key: subject.key, option: chosen, reason: reason.trim() });
      onClose();
    } catch {
      // a stale choice comes back with its reason; the list is read again
      options.refetch();
    }
  };

  return (
    <Modal
      open={Boolean(subject)}
      onClose={onClose}
      icon={Plus}
      tone="indigo"
      title="More actions"
      subtitle={subject ? `${subject.name} · adapted to what they hold today` : undefined}
      widthClass="max-w-2xl"
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
            disabled={!chosen || !reason.trim() || add.isLoading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {add.isLoading ? 'Adding…' : 'Add to execution'}
          </button>
        </div>
      }
    >
      {options.isLoading && <p className="text-sm text-slate-500">Reading what is possible…</p>}

      {options.data?.reason && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {options.data.reason}
        </p>
      )}

      {!options.isLoading && !options.data?.reason && rows.length === 0 && (
        <p className="text-sm text-slate-500">Nothing else can be done for this person right now.</p>
      )}

      {rows.length > 0 && (
        <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => setPicked(row.key)}
              aria-pressed={picked === row.key}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                picked === row.key
                  ? 'border-violet-300 bg-violet-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="block text-sm font-semibold text-slate-900">
                {row.service_name} · {row.action_label}
              </span>
              <span className="block text-xs text-slate-500">
                {row.target_scope} scope
                {row.device_label ? ` · ${row.device_label}` : ''} · {row.current_state}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        <FieldLabel required>Technician note</FieldLabel>
        <textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this additional action needed?"
          aria-label="Technician note"
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
        />
      </div>

      {add.error instanceof Error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {add.error.message}
        </p>
      )}
    </Modal>
  );
};

export default MoreActionsModal;
