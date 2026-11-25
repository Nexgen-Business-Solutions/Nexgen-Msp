import React, { useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import type { UserActivityEvent } from '@/lib/api/internal';
import { useUserHistory } from '../hooks/useUsers';
import { usePortalUserFileHistory } from '@/features/portal/hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

// a quiet vertical timeline: a dot per event on a hairline, the date above what happened
const Timeline: React.FC<{ events: UserActivityEvent[] }> = ({ events }) => (
  <ol className="relative ml-1.5 space-y-3 border-l border-slate-200 pl-5">
    {events.map((event, index) => (
      <li key={`${event.entity}-${index}`} className="relative">
        <span
          aria-hidden
          className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-white ring-2 ring-blue-400"
        />
        <p className="text-xs tabular-nums text-slate-400">{fmtDate(event.on)}</p>
        <p className="text-sm text-slate-700">
          {event.what}
          {event.via && <span className="text-slate-400"> via {event.via}</span>}
        </p>
      </li>
    ))}
  </ol>
);

/**
 * What happened before now. It is not carried with the page: the first reading holds the
 * last handful of events, and the rest is fetched the moment somebody asks for it.
 *
 * Past devices and closed services are not repeated here: the page already lists every service
 * in any state, and every holding, in its own tables.
 */
const UserHistoryPanel: React.FC<{
  name: string;
  recent: UserActivityEvent[];
  /** read through the customer's own door */
  portal?: boolean;
}> = ({ name, recent, portal = false }) => {
  const [open, setOpen] = useState(false);
  const ours = useUserHistory(portal ? undefined : name, open);
  const theirs = usePortalUserFileHistory(portal ? name : undefined, open);
  const history = portal ? theirs : ours;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-500 ring-1 ring-slate-200">
          <History size={16} strokeWidth={1.75} />
        </span>
        <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
      </div>

      <div className="mt-4">
        {recent.length ? (
          <Timeline events={recent} />
        ) : (
          <p className="text-sm text-slate-400">Nothing has happened yet.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
      >
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {open ? 'Hide older activity' : 'Load older activity'}
      </button>

      {open && history.data && (
        <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Closed requests
            </p>
            {history.data.past_requests.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {history.data.past_requests.map((row) => (
                  <li
                    key={row.name}
                    className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200"
                  >
                    {row.name} — {row.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-400">No request has been closed for them.</p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Everything, oldest last
            </p>
            <div className="mt-3">
              <Timeline events={history.data.activity} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UserHistoryPanel;
