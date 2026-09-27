import React, { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { TechnicianOption } from '@/lib/api/internal';
import { useAddTechnicianAction, useTechnicianOptions } from '../../hooks/useRequests';

type Props = {
  request: string;
  subjectKey: string | null;
  onClose: () => void;
};

/** Work the request did not ask for, offered from what the person and their machines allow. */
const MoreActionsModal: React.FC<Props> = ({ request, subjectKey, onClose }) => {
  const offered = useTechnicianOptions(request, subjectKey);
  const add = useAddTechnicianAction();
  const [chosen, setChosen] = useState<TechnicianOption | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setChosen(null);
    setReason('');
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  const options = offered.data?.options ?? [];

  const submit = async () => {
    if (!chosen) return;

    try {
      await add.mutateAsync({
        name: request,
        subject_key: subjectKey as string,
        option: chosen,
        reason: reason.trim(),
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
      icon={Settings2}
      tone="indigo"
      title="More actions"
      subtitle="Choose an additional operational action for the current person, Device or service state."
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit()}
            disabled={!chosen || !reason.trim() || add.isLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {add.isLoading ? 'Working…' : 'Add to execution'}
          </button>
        </div>
      }
    >
      {offered.data?.reason && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
          {offered.data.reason}
        </p>
      )}

      <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
        {offered.isLoading && <p className="px-3 py-4 text-sm text-slate-500">Loading…</p>}

        {!offered.isLoading && options.length === 0 && (
          <p className="px-3 py-4 text-sm text-slate-500">
            Nothing further applies to this person right now.
          </p>
        )}

        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setChosen(option)}
            className={`flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
              chosen?.key === option.key ? 'bg-indigo-50' : 'hover:bg-slate-50'
            }`}
          >
            <span className="text-sm font-semibold text-slate-900">
              {option.action_label}
              {' · '}
              {option.service_name}
            </span>
            <span className="text-xs text-slate-500">
              {option.target_scope} scope
              {option.device_label ? ` · ${option.device_label}` : ''}
              {` · currently ${option.current_state.toLowerCase()}`}
            </span>
            {option.description && (
              <span className="text-xs text-slate-500">{option.description}</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <FieldLabel required>Technician note</FieldLabel>
        <textarea
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this additional action needed?"
          aria-label="Technician note"
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
