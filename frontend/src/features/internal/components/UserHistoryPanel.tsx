import React, { useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import type { UserActivityEvent } from '@/lib/api/internal';
import { useUserHistory } from '../hooks/useUsers';
import { usePortalUserFileHistory } from '@/features/portal/hooks/usePortal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const Timeline: React.FC<{ events: UserActivityEvent[] }> = ({ events }) => (
  <ol className="space-y-1.5">
    {events.map((event, index) => (
      <li key={`${event.entity}-${index}`} className="flex flex-wrap gap-x-2 text-xs text-slate-600">
        <span className="font-mono text-slate-400">{fmtDate(event.on)}</span>
        <span>{event.what}</span>
        {event.via && <span className="text-slate-400">via {event.via}</span>}
      </li>
    ))}
  </ol>
);

/**
 * What happened before now. It is not carried with the page: the first reading holds the
 * last handful of events, and the rest is fetched the moment somebody asks for it.
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
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <History size={14} className="text-slate-400" />
        Recent activity
      </h2>

      <div className="mt-2">
        {recent.length ? (
          <Timeline events={recent} />
        ) : (
          <p className="text-xs text-slate-400">Nothing has happened yet.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900"
      >
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {open ? 'Hide older activity' : 'Load older activity'}
      </button>

      {open && history.data && (
        <div className="mt-3 space-y-4 border-t border-slate-100 pt-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Past devices
            </p>
            {history.data.past_devices.length ? (
              <ul className="mt-1 space-y-0.5">
                {history.data.past_devices.map((row) => (
                  <li key={row.period} className="text-xs text-slate-600">
                    {row.hostname}
                    {row.serial_number ? ` · ${row.serial_number}` : ''} — held{' '}
                    {fmtDate(row.held_from)} to {fmtDate(row.held_until)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-400">They have never given a machine back.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Past personal services
            </p>
            {history.data.past_personal_services.length ? (
              <ul className="mt-1 space-y-0.5">
                {history.data.past_personal_services.map((row) => (
                  <li key={row.name} className="text-xs text-slate-600">
                    {row.service_name} — {row.operational_status.toLowerCase()}{' '}
                    {fmtDate(row.effective_end_date)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-400">Nothing of theirs has been closed.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Closed requests
            </p>
            {history.data.past_requests.length ? (
              <ul className="mt-1 space-y-0.5">
                {history.data.past_requests.map((row) => (
                  <li key={row.name} className="text-xs text-slate-600">
                    {row.name} — {row.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-400">No request has been closed for them.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Everything, oldest last
            </p>
            <div className="mt-1">
              <Timeline events={history.data.activity} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UserHistoryPanel;
