import React, { useEffect, useState } from 'react';
import { AlertCircle, CircleX, PauseCircle, PlayCircle } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import type { CustomerRequestRef, UserServiceRow } from '@/lib/api/internal';
import RequestReferenceField from './RequestReferenceField';
import { useChangeService } from '../hooks/useUsers';

export type ServiceAction = 'Suspend' | 'Resume' | 'End';

type Props = {
  clientUser: string;
  target: { row: UserServiceRow; action: ServiceAction } | null;
  requests: CustomerRequestRef[];
  defaultRequest?: string;
  onClose: () => void;
};

const COPY: Record<
  ServiceAction,
  {
    title: string;
    subtitle: string;
    confirm: string;
    tone: string;
    icon: typeof CircleX;
    modalTone: 'amber' | 'blue' | 'red';
  }
> = {
  Suspend: {
    title: 'Suspend this service',
    subtitle: 'Billing goes on hold. The service can be resumed later.',
    confirm: 'Suspend',
    tone: 'bg-amber-600 hover:bg-amber-700',
    icon: PauseCircle,
    modalTone: 'amber',
  },
  Resume: {
    title: 'Resume this service',
    subtitle: 'The service becomes active and billable again.',
    confirm: 'Resume',
    tone: 'bg-blue-600 hover:bg-blue-700',
    icon: PlayCircle,
    modalTone: 'blue',
  },
  End: {
    title: 'End this service',
    subtitle: 'The assignment is closed on the date you choose. History is kept.',
    confirm: 'End service',
    tone: 'bg-red-600 hover:bg-red-700',
    icon: CircleX,
    modalTone: 'red',
  },
};

const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700';
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const today = () => new Date().toISOString().slice(0, 10);

const ServiceActionModal: React.FC<Props> = ({
  clientUser,
  target,
  requests,
  defaultRequest,
  onClose,
}) => {
  const change = useChangeService(clientUser);
  const [endDate, setEndDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [sourceRequest, setSourceRequest] = useState('');

  useEffect(() => {
    if (!target) return;
    setEndDate(today());
    setNotes('');
    setSourceRequest(defaultRequest ?? '');
    change.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  const copy = COPY[target.action];

  const submit = async () => {
    try {
      await change.mutateAsync({
        assignment: target.row.name,
        action: target.action,
        effective_date: target.action === 'End' ? endDate : undefined,
        notes: notes.trim() || undefined,
        source_request: sourceRequest || undefined,
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
      icon={copy.icon}
      tone={copy.modalTone}
      title={copy.title}
      subtitle={copy.subtitle}
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
            disabled={change.isLoading}
            className={`flex min-w-[7rem] items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${copy.tone}`}
          >
            {change.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              copy.confirm
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{target.row.service_name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {target.row.hostname ? `${target.row.hostname} · ` : ''}
            open since {(target.row.effective_start_date ?? 'N/A').slice(0, 10)}
          </p>
        </div>

        {target.action === 'End' && (
          <div>
            <FieldLabel required>End date</FieldLabel>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={inputClass}
            />
          </div>
        )}

        <RequestReferenceField
          requests={requests}
          value={sourceRequest}
          onChange={setSourceRequest}
        />

        <div>
          <span className={labelClass}>Internal note</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What you did and why — kept for Nexgen, not shown to the customer."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {change.error instanceof Error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{change.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ServiceActionModal;
