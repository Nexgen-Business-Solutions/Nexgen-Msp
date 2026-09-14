import React from 'react';
import { Check } from 'lucide-react';
import type { ExecutionPlan, RecapEntry } from '@/lib/api/internal';
import { banner, btnPrimary, fmtStamp, nextBar, pill, warnBar } from '../../lib/fulfilmentStyles';

const TAG: Record<RecapEntry['kind'], { label: string; tone: 'blue' | 'violet' | 'emerald' }> = {
  requested: { label: 'Request line', tone: 'blue' },
  technician: { label: 'Additional action', tone: 'violet' },
  object: { label: 'Created / prepared', tone: 'emerald' },
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
  </div>
);

/** Step 3: what was actually done, read from the work that did it. Not a list to tick. */
const ExecutionRecap: React.FC<{ plan: ExecutionPlan; onContinue?: () => void }> = ({ plan, onContinue }) => {
  const recap = plan.recap;
  const bySubject = new Map<string, RecapEntry[]>();

  for (const entry of recap) {
    const key = entry.subject_key ?? entry.work_order;
    bySubject.set(key, [...(bySubject.get(key) ?? []), entry]);
  }

  return (
    <div className="space-y-4">
      <div className={banner}>
        <p className="font-semibold">What was actually done</p>
        <p className="mt-0.5">
          This is not a checklist to complete. It is the history the work just performed left
          behind.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Total operations" value={recap.length} />
        <Stat label="Requested actions" value={recap.filter((row) => row.kind === 'requested').length} />
        <Stat label="Additional actions" value={recap.filter((row) => row.kind === 'technician').length} />
        <Stat label="Created / prepared" value={recap.filter((row) => row.kind === 'object').length} />
      </div>

      {recap.length === 0 ? (
        <p className={warnBar}>No operation has been recorded yet.</p>
      ) : (
        [...bySubject.values()].map((entries) => (
          <div key={entries[0].work_order} className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <p className="text-sm font-bold text-slate-900">{entries[0].subject ?? 'Unnamed person'}</p>
              <p className="text-xs text-slate-500">
                {[entries[0].department, `${entries.length} operation${entries.length > 1 ? 's' : ''}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {entries.map((entry) => (
              <div
                key={entry.work_order}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600"
                >
                  <Check size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[entry.detail, fmtStamp(entry.at), entry.by].filter(Boolean).join(' · ')}
                  </p>
                  {entry.reason && <p className="mt-0.5 text-xs text-violet-700">{entry.reason}</p>}
                </div>
                <span className={`col-start-2 w-max sm:col-start-auto ${pill(TAG[entry.kind].tone)}`}>
                  {TAG[entry.kind].label}
                </span>
              </div>
            ))}
          </div>
        ))
      )}

      {onContinue && (
        <div className={nextBar}>
          <div>
            <p className="text-sm font-semibold text-emerald-800">Execution recap ready</p>
            <p className="text-xs text-emerald-700">Review the operations above before the final validation.</p>
          </div>
          <button type="button" onClick={onContinue} className={btnPrimary}>
            Continue to Final validation
          </button>
        </div>
      )}
    </div>
  );
};

export default ExecutionRecap;
