import React, { useEffect, useState } from 'react';
import { AlertCircle, ListChecks } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import type { RequestActionRow } from '@/lib/api/internal';
import { useSaveRequestAction, useSettingsOptions } from '../hooks/useSettings';

type Props = {
  open: boolean;
  action: RequestActionRow | null;
  onClose: () => void;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const TYPE_HINTS: Record<string, string> = {
  Add: 'Grants something the holder does not have. The only type offered for a new person.',
  Change: 'Adjusts a service already in place.',
  Suspend: 'Pauses a service and stops billing it.',
  Resume: 'Restarts a paused service.',
  Remove: 'Ends a service for good.',
};

const RequestActionModal: React.FC<Props> = ({ open, action, onClose }) => {
  const options = useSettingsOptions();
  const save = useSaveRequestAction();

  const [title, setTitle] = useState('');
  const [type, setType] = useState('Add');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setTitle(action?.title ?? '');
    setType(action?.action_type ?? 'Add');
    setDescription(action?.description ?? '');
    setEnabled(action ? Boolean(action.enabled) : true);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  const submit = async () => {
    try {
      await save.mutateAsync({
        name: action?.name,
        action: { title, action_type: type, description, enabled: enabled ? 1 : 0 },
      });
      onClose();
    } catch {
      // surfaced below
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={ListChecks}
      tone="blue"
      title={action ? 'Edit this action' : 'New action'}
      subtitle="What the customer reads, and what it makes the engine do."
      widthClass="max-w-2xl"
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
            disabled={!title.trim() || save.isLoading}
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <FieldLabel required>Title</FieldLabel>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Replace a laptop"
            className={inputClass}
          />
        </div>

        <div>
          <FieldLabel required>Action type</FieldLabel>
          <Select
            className="w-full"
            value={type}
            onChange={setType}
            options={(options.data?.action_types ?? []).map((value) => ({
              value,
              label: value,
              description: TYPE_HINTS[value],
            }))}
          />
        </div>

        <div>
          <FieldLabel>Description</FieldLabel>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Move the services onto a new machine."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Offered to customers
        </label>

        {save.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RequestActionModal;
