import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import type { UserOpenRequest } from '@/lib/api/internal';

/** What is being done for them right now, ahead of anything that already happened. */
const UserOpenRequests: React.FC<{
  requests: UserOpenRequest[];
  onOpen: (request: string) => void;
}> = ({ requests, onOpen }) => {
  if (!requests.length) return null;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:px-6">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">Open requests</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
          {requests.length}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-slate-500">Work Nexgen is doing for this person right now.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {requests.map((request) => {
          const done = request.work_total ? Math.round((request.work_done / request.work_total) * 100) : 0;

          return (
            <button
              key={request.name}
              type="button"
              onClick={() => onOpen(request.name)}
              className="group flex w-full flex-col gap-2 rounded-xl px-4 py-3.5 text-left ring-1 ring-slate-200 transition hover:bg-slate-50/80 hover:ring-slate-300"
            >
              <div className="flex w-full items-start justify-between gap-3">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  {request.name}
                  <ArrowUpRight
                    size={14}
                    className="text-slate-400 transition-colors group-hover:text-blue-600"
                  />
                </p>
                <StatusBadge value={request.status} />
              </div>
              <ul className="space-y-0.5">
                {request.lines.map((line) => (
                  <li key={line.idx} className="text-[13px] text-slate-600">
                    {line.action} {line.service_name}
                    {line.hostname ? ` on ${line.hostname}` : ''}
                  </li>
                ))}
              </ul>
              {!!request.work_total && (
                <div className="flex items-center gap-3">
                  <span className="h-1.5 w-full rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-blue-500 transition-[width] duration-500"
                      style={{ width: `${done}%` }}
                    />
                  </span>
                  <p className="shrink-0 text-xs text-slate-500">
                    {request.work_done} of {request.work_total} work items done
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default UserOpenRequests;
