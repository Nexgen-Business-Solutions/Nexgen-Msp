import React, { useState } from 'react';
import { AlertCircle, CircleX } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import { useCancelRequestedClientUser, useCancelRequestedDevice } from '../../hooks/useRequests';
import { secondaryButton } from '../../lib/workDisplay';

type Props = {
  entity: RequestedEntityPresentation;
  goesWith: { key: string; action: string; target: string }[];
  onClose: () => void;
  onSaved: () => void;
};

const CancelRequestedEntityModal: React.FC<Props> = ({ entity, goesWith, onClose, onSaved }) => {
  const person = entity.kind === 'client_user';
  const cancelPerson = useCancelRequestedClientUser();
  const cancelDevice = useCancelRequestedDevice();
  const cancel = person ? cancelPerson : cancelDevice;
  const [reason, setReason] = useState('');
  const label = person ? 'Cancel requested user' : 'Cancel requested Device';

  const submit = async () => {
    if (!reason.trim() || !entity.name) return;
    try {
      await cancel.mutateAsync({ name: entity.name, reason: reason.trim() });
      onSaved();
      onClose();
    } catch {
      return;
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={CircleX}
      tone="red"
      title={label}
      subtitle={entity.display_name}
      widthClass="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!reason.trim() || cancel.isLoading}
            className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {label}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {goesWith.length > 0 && (
          <section aria-label="Cancelled with it" className="overflow-hidden rounded-xl ring-1 ring-slate-200/70">
            <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Cancelled with it
            </p>
            <ul className="divide-y divide-slate-100">
              {goesWith.map((row) => (
                <li key={row.key} className="px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-900">{row.action}</span>
                  <span className="text-slate-500"> · {row.target}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div>
          <FieldLabel required>Reason</FieldLabel>
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="Reason"
            className="w-full resize-y rounded-xl border-0 bg-slate-100/80 px-3.5 py-3 text-sm outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {cancel.error instanceof Error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 ring-1 ring-red-100 px-3 py-2 text-sm font-medium text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {cancel.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default CancelRequestedEntityModal;
