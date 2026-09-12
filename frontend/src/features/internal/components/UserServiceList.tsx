import React from 'react';
import { ArrowUpRight, CircleX, FilePlus2, PauseCircle, PlayCircle, Plus } from 'lucide-react';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import type { ServiceOffer, UserServiceEntry } from '@/lib/api/internal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

// carried out here and now, the way it has always worked on this page
const DIRECT: Record<string, { label: string; icon: typeof CircleX; tone: string }> = {
  Suspend: {
    label: 'Suspend',
    icon: PauseCircle,
    tone: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  },
  Resume: {
    label: 'Resume',
    icon: PlayCircle,
    tone: 'border-blue-200 text-blue-700 hover:bg-blue-50',
  },
  Remove: { label: 'Close', icon: CircleX, tone: 'border-red-200 text-red-600 hover:bg-red-50' },
};

// asked for instead, so the work is planned, carried out and verified from the request
const ASK: Record<string, string> = {
  Change: 'Request a change',
  Suspend: 'Request a suspension',
  Resume: 'Request a resumption',
  Remove: 'Request a closure',
};

type Props = {
  services: UserServiceEntry[];
  available: ServiceOffer[];
  emptyMessage: string;
  onAsk: (service: UserServiceEntry, action: string) => void;
  onAdd: (offer: ServiceOffer) => void;
  onOpenRequest: (request: string) => void;
  onApply: (service: UserServiceEntry, action: string) => void;
};

/**
 * What is running, and the two ways to change it.
 *
 * Acting here and now is what this page has always done, and it stays. Raising a request
 * instead sits beside it, for work somebody else will carry out and verify.
 *
 * A service somebody has already raised a request about offers neither: asking a second,
 * contradictory thing of one service is refused at the door, so it is not offered here.
 */
const UserServiceList: React.FC<Props> = ({
  services,
  available,
  emptyMessage,
  onAsk,
  onAdd,
  onOpenRequest,
  onApply,
}) => (
  <div>
    {services.length === 0 && (
      <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">{emptyMessage}</p>
    )}

    <div className="space-y-2">
      {services.map((service) => {
        const direct = service.allowed_actions.filter((action) => DIRECT[action]);

        return (
          <div
            key={service.name}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{service.service_name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {service.operational_status} since {fmtDate(service.effective_start_date)}
                {service.quantity && service.quantity !== 1
                  ? ` · quantity ${service.quantity}`
                  : ''}
              </p>
              {service.pending_request && (
                <button
                  type="button"
                  onClick={() => onOpenRequest(service.pending_request as string)}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                >
                  Change in progress · {service.pending_request}
                  <ArrowUpRight size={12} />
                </button>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {direct.map((action) => {
                const Icon = DIRECT[action].icon;

                return (
                  <button
                    key={action}
                    type="button"
                    onClick={() => onApply(service, action)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold transition-colors ${DIRECT[action].tone}`}
                  >
                    <Icon size={13} />
                    {DIRECT[action].label}
                  </button>
                );
              })}

              {service.allowed_actions.length > 0 && (
                <RowActionsMenu
                  actions={service.allowed_actions.map((action) => ({
                    label: ASK[action] ?? `Request ${action.toLowerCase()}`,
                    icon: FilePlus2,
                    onClick: () => onAsk(service, action),
                  }))}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>

    {available.length > 0 && (
      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Available</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {available.map((offer) => (
            <button
              key={offer.service_item}
              type="button"
              onClick={() => onAdd(offer)}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              <Plus size={12} />
              {offer.item_name}
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);

export default UserServiceList;
