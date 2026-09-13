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
    hint: string;
    confirm: string;
    tone: string;
    icon: typeof CircleX;
    modalTone: 'amber' | 'blue' | 'red';
    dateLabel: string;
  }
> = {
  Suspend: {
    title: 'Suspend this service',
    subtitle: 'Billing goes on hold. The service can be resumed later.',
    hint: 'Billing is paused from the day the service is suspended.',
    confirm: 'Suspend',
    tone: 'bg-amber-600 hover:bg-amber-700',
    icon: PauseCircle,
    modalTone: 'amber',
    dateLabel: 'Suspend from',
  },
  Resume: {
    title: 'Resume this service',
    subtitle: 'The service becomes active and billable again.',
    hint: 'Billing resumes from the day the service comes back.',
    confirm: 'Resume',
    tone: 'bg-blue-600 hover:bg-blue-700',
    icon: PlayCircle,
    modalTone: 'blue',
    dateLabel: 'Resume on',
  },
  End: {
    title: 'Close this service',
    subtitle: 'The assignment is closed on the date you choose. History is kept.',
    hint: 'This service will remain in history. Re-adding it later creates a new service period.',
    confirm: 'Close service',
    tone: 'bg-red-600 hover:bg-red-700',
    icon: CircleX,
    modalTone: 'red',
    dateLabel: 'Close on',
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
  const [actionDate, setActionDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [sourceRequest, setSourceRequest] = useState('');

  useEffect(() => {
    if (!target) return;
    setActionDate(today());
    setNotes('');
    setSourceRequest(defaultRequest ?? '');
    change.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  const copy = COPY[target.action];
  const billedTo = target.row.last_billed_on?.slice(0, 10) ?? null;
  // closing behind what was already invoiced is allowed; the invoice itself stays as it is
  const closesBilledDays = target.action === 'End' && Boolean(billedTo) && actionDate <= (billedTo ?? '');

  const submit = async () => {
    try {
      await change.mutateAsync({
        assignment: target.row.name,
        action: target.action,
        effective_date: actionDate,
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
          {target.row.device_serial_number && (
            <p className="mt-1 text-xs text-slate-500">Serial: {target.row.device_serial_number}</p>
          )}
          {target.row.device_user_name && (
            <p className="mt-1 text-xs text-slate-500">Current holder: {target.row.device_user_name}</p>
          )}
        </div>

        <div>
          <FieldLabel required>{copy.dateLabel}</FieldLabel>
          <input
            type="date"
            value={actionDate}
            onChange={(event) => setActionDate(event.target.value)}
            className={inputClass}
          />
        </div>

        <p className="text-xs leading-relaxed text-slate-500">{copy.hint}</p>

        {target.action === 'End' && billedTo && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              closesBilledDays
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <p className="font-medium">Invoiced up to {billedTo}.</p>
            {closesBilledDays ? (
              <p className="mt-1">
                Closing it on {actionDate} is accepted. The invoice already issued stays as it
                is and no credit note is created.
              </p>
            ) : (
              <p className="mt-1">Nothing after {billedTo} has been invoiced yet.</p>
            )}
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
