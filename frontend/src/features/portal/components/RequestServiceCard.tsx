import React from 'react';
import { Clock, Plus } from 'lucide-react';
import type { RequestAction, RequestCurrentService, RequestServiceOffer } from '@/lib/api/portal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : null);

const chip =
  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const TONE: Record<string, string> = {
  Add: 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50',
  Change: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  Suspend: 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50',
  Resume: 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50',
  Remove: 'border-red-200 bg-white text-red-600 hover:bg-red-50',
};

/** A service already running, with only the acts it can actually receive. */
export const CurrentServiceRow: React.FC<{
  service: RequestCurrentService;
  askedAction?: string;
  onAct: (action: RequestAction) => void;
  onUndo: () => void;
}> = ({ service, askedAction, onAct, onUndo }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{service.label}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        {service.status}
        {fmtDate(service.since) ? ` since ${fmtDate(service.since)}` : ''}
      </p>
      {service.pending_request && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <Clock size={12} />
          Already requested — {service.pending_request}
        </p>
      )}
    </div>

    {askedAction ? (
      <button
        type="button"
        onClick={onUndo}
        className={`${chip} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
      >
        {askedAction} added — remove
      </button>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        {service.allowed_request_actions.map((action) => (
          <button
            key={action.name}
            type="button"
            onClick={() => onAct(action)}
            className={`${chip} ${TONE[action.action_type] ?? TONE.Change}`}
          >
            {action.title || action.action_type}
          </button>
        ))}
      </div>
    )}
  </div>
);

/** A service that could be started here, offered as one click. */
export const AvailableServiceRow: React.FC<{
  offer: RequestServiceOffer;
  asked: boolean;
  onAdd: (action: RequestAction) => void;
  onUndo: () => void;
}> = ({ offer, asked, onAdd, onUndo }) => {
  const add = offer.allowed_request_actions[0];

  return (
    <button
      type="button"
      onClick={() => (asked ? onUndo() : add && onAdd(add))}
      disabled={!add}
      className={`${chip} ${
        asked
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : TONE.Add
      }`}
    >
      <Plus size={13} />
      {offer.item_name}
      {asked ? ' — added' : ''}
    </button>
  );
};
