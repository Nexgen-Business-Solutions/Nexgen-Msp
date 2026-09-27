import React, { useState } from 'react';
import { Check } from 'lucide-react';
import type { ExecutionPlan, RecapEntry } from '@/lib/api/internal';
import { banner, btnPrimary, fmtStamp, nextBar, pill, warnBar } from '../../lib/fulfilmentStyles';

const TAG: Record<RecapEntry['kind'], { label: string; tone: 'blue' | 'violet' | 'emerald' }> = {
  requested: { label: 'REQUESTED', tone: 'blue' },
  technician: { label: 'ADDITIONAL ACTION', tone: 'violet' },
  object: { label: 'CREATED / PREPARED', tone: 'emerald' },
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
  // grouped execution is now the ordinary way to work, so the recap opens on the act
  const [reading, setReading] = useState<'action' | 'person'>('action');

  const gathered = new Map<string, { title: string; hint: string; entries: RecapEntry[] }>();

  for (const entry of recap) {
    const asked =
      reading === 'action'
        ? plan.action_groups?.find((row) => row.group_key === entry.action_group_key)
        : undefined;
    const key =
      reading === 'action'
        ? (entry.action_group_key ?? (entry.kind === 'requested' ? entry.title : 'technician'))
        : (entry.subject_key ?? entry.work_order);
    const found = gathered.get(key) ?? {
      title:
        reading === 'action'
          ? (asked?.label ?? (entry.kind === 'requested' ? entry.title : 'Additional actions'))
          : (entry.subject ?? 'Unnamed person'),
      hint: reading === 'action' ? (asked?.scope_label ?? '') : (entry.department ?? ''),
      entries: [],
    };

    found.entries.push(entry);
    gathered.set(key, found);
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

      <div className="flex items-center gap-1.5">
        {(['action', 'person'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={reading === value}
            onClick={() => setReading(value)}
            className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
              reading === value
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            By {value}
          </button>
        ))}
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
        [...gathered.values()].map(({ title, hint, entries }) => (
          <div key={entries[0].work_order} className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <p className="text-sm font-bold text-slate-900">{title}</p>
              <p className="text-xs text-slate-500">
                {[hint, `${entries.length} operation${entries.length > 1 ? 's' : ''}`]
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
                  {/* the group already names one side of it; the row names the other */}
                  <p className="text-sm font-semibold text-slate-900">
                    {reading === 'action' ? (entry.subject ?? entry.title) : entry.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[
                      reading === 'action' ? entry.department : entry.detail,
                      fmtStamp(entry.at),
                      entry.by,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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
