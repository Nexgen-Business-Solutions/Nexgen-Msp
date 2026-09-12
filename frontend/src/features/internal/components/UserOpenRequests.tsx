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
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Open requests
      </h2>

      <div className="mt-2 space-y-2">
        {requests.map((request) => (
          <button
            key={request.name}
            type="button"
            onClick={() => onOpen(request.name)}
            className="flex w-full flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
          >
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                {request.name}
                <ArrowUpRight size={13} className="text-slate-400" />
              </p>
              <ul className="mt-1 space-y-0.5">
                {request.lines.map((line) => (
                  <li key={line.idx} className="text-xs text-slate-600">
                    {line.action} {line.service_name}
                    {line.hostname ? ` on ${line.hostname}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-400">
                {request.technician ? `Technician: ${request.technician}` : 'Nobody assigned yet'}
                {request.work_total
                  ? ` · ${request.work_done} of ${request.work_total} work items done`
                  : ''}
              </p>
            </div>
            <StatusBadge value={request.status} />
          </button>
        ))}
      </div>
    </section>
  );
};

export default UserOpenRequests;
