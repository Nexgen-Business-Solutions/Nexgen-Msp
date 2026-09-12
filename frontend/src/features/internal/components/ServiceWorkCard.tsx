import React, { useState } from 'react';
import { Laptop, Play, User } from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';
import { useExecuteServiceAction } from '../hooks/useRequests';
import VerificationChecklist from './VerificationChecklist';
import WorkCardShell from './WorkCardShell';

const inputClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500';

const VERB: Record<string, string> = {
  Add: 'Activate service',
  Change: 'Apply change',
  Suspend: 'Suspend service',
  Resume: 'Resume service',
  Remove: 'Close service',
};

type Props = {
  card: WorkCard;
  person: SubjectWorkGroup['person'];
};

/** One act on one service, with the person, the machine and the current state in front of it. */
const ServiceWorkCard: React.FC<Props> = ({ card, person }) => {
  const [date, setDate] = useState(card.effective_date ?? '');
  const [quantity, setQuantity] = useState(String(card.requested_quantity ?? 1));
  const [identifier, setIdentifier] = useState('');

  const run = useExecuteServiceAction();
  const onDevice = card.target_scope === 'Device';

  // the one fact the service is issued against, asked for here when the record has none
  const missing = onDevice
    ? !card.device?.serial_number && ['Add', 'Change'].includes(card.action)
    : !person?.username && ['Add', 'Change'].includes(card.action);

  return (
    <WorkCardShell
      card={card}
      title={`${card.action} · ${card.service_name ?? card.service_item}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="inline-flex items-center gap-1">
            <User size={11} className="text-slate-400" />
            {person?.full_name ?? 'Unassigned'}
          </span>
          {onDevice && (
            <span className="inline-flex items-center gap-1">
              <Laptop size={11} className="text-slate-400" />
              {card.device?.hostname ?? 'machine to be settled'}
              {card.device?.serial_number ? ` · ${card.device.serial_number}` : ''}
            </span>
          )}
          {card.current && (
            <span>
              Currently {card.current.operational_status.toLowerCase()}
              {card.current.quantity ? ` · quantity ${card.current.quantity}` : ''}
            </span>
          )}
          {card.status === 'Completed' && card.resulting_assignment && (
            <span>{card.resulting_assignment}</span>
          )}
        </span>
      }
    >
      {card.comment && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {card.comment}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel>Effective date</FieldLabel>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        {card.action === 'Change' && (
          <div>
            <FieldLabel>Quantity</FieldLabel>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
        )}

        {missing && (
          <div>
            <FieldLabel required>{onDevice ? 'Serial number' : 'Account name'}</FieldLabel>
            <input
              className={inputClass}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={onDevice ? 'Read it off the machine' : 'The name on the licence'}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={run.isLoading || (missing && !identifier.trim())}
        onClick={() =>
          run.mutate({
            work_order: card.name,
            effective_date: date || undefined,
            quantity: card.action === 'Change' ? Number(quantity) : undefined,
            username: !onDevice && identifier.trim() ? identifier.trim() : undefined,
            serial_number: onDevice && identifier.trim() ? identifier.trim() : undefined,
          })
        }
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        <Play size={14} />
        {VERB[card.action] ?? 'Execute'}
      </button>

      {run.error instanceof Error && (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {run.error.message}
        </p>
      )}
    </WorkCardShell>
  );
};

/** Once it has run, the same card asks for the sign-off instead of the act. */
export const ServiceWorkResult: React.FC<Props> = ({ card, person }) => (
  <WorkCardShell
    card={card}
    title={`${card.action} · ${card.service_name ?? card.service_item}`}
    subtitle={
      <span className="flex flex-wrap items-center gap-x-3">
        <span>{person?.full_name}</span>
        {card.target_scope === 'Device' && card.device && (
          <span>
            {card.device.hostname}
            {card.device.serial_number ? ` · ${card.device.serial_number}` : ''}
          </span>
        )}
        {card.resulting_assignment && <span>{card.resulting_assignment}</span>}
      </span>
    }
  >
    <VerificationChecklist card={card} />
  </WorkCardShell>
);

export default ServiceWorkCard;
