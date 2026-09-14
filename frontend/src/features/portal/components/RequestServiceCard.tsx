import React from 'react';
import { CircleX, Clock, PauseCircle, PencilLine, PlayCircle, Plus, type LucideIcon } from 'lucide-react';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
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

const ICON: Record<string, LucideIcon> = {
  Change: PencilLine,
  Suspend: PauseCircle,
  Resume: PlayCircle,
  Remove: CircleX,
};

/**
 * A service already running, with only the acts it can actually receive. Removing it is the
 * one on show; the others wait behind the ⋯.
 */
export const CurrentServiceRow: React.FC<{
  service: RequestCurrentService;
  askedAction?: string;
  onAct: (action: RequestAction) => void;
  onUndo: () => void;
}> = ({ service, askedAction, onAct, onUndo }) => {
  const actions = service.allowed_request_actions;
  const main = actions.find((action) => action.action_type === 'Remove') ?? actions[0];
  const others = actions.filter((action) => action !== main);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{service.label}</span>
          <span className="text-xs">
            {' · '}
            {service.status}
            {fmtDate(service.since) ? ` since ${fmtDate(service.since)}` : ''}
          </span>
        </p>
        {service.pending_request && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
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
        <div className="flex items-center gap-1.5">
          {main && (
            <button
              type="button"
              onClick={() => onAct(main)}
              className={`${chip} ${TONE[main.action_type] ?? TONE.Change}`}
            >
              {main.title || main.action_type}
            </button>
          )}
          {others.length > 0 && (
            <RowActionsMenu
              actions={others.map((action) => ({
                label: action.title || action.action_type,
                icon: ICON[action.action_type] ?? PencilLine,
                onClick: () => onAct(action),
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
};

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
      title={offer.warning ?? undefined}
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
