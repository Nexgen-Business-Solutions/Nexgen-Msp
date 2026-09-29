import React, { useState } from 'react';
import type { ExecutionPlan, RecapEntry } from '@/lib/api/internal';
import { badgeClass, toneOfBadge } from '@/shared/request/format';
import { fmtStamp } from '../../lib/fulfilmentStyles';
import { compactBadge, primaryButton } from '../../lib/workDisplay';

const TAG: Record<RecapEntry['kind'], { label: string; tone: string }> = {
  requested: { label: 'REQUESTED', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
  technician: { label: 'ADDITIONAL ACTION', tone: 'border-violet-200 bg-violet-50 text-violet-700' },
  object: { label: 'RESOLVED', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'CANCELLED', tone: 'border-slate-200 bg-slate-50 text-slate-500' },
};

const Figure: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2">
    <p className="text-lg font-bold text-slate-900">{value}</p>
    <p className="text-[11px] text-slate-500">{label}</p>
  </div>
);

const Block: React.FC<{ title: string; aside?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  aside,
  children,
}) => (
  <section aria-label={title} className="overflow-hidden rounded-lg border border-slate-200">
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs font-bold text-slate-900">{title}</p>
      {aside}
    </div>
    <div className="divide-y divide-slate-100 px-3">{children}</div>
  </section>
);

const Line: React.FC<{ entry: RecapEntry; label: string }> = ({ entry, label }) => (
  <div className="flex flex-wrap items-start justify-between gap-2 py-2">
    <div className="min-w-0">
      <p className="text-xs font-semibold text-slate-900">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {[entry.detail, fmtStamp(entry.at), entry.by].filter(Boolean).join(' · ')}
      </p>
      {entry.reason && <p className="mt-0.5 text-[11px] text-violet-700">{entry.reason}</p>}
    </div>
    <span className={`${compactBadge} ${TAG[entry.kind].tone}`}>{TAG[entry.kind].label}</span>
  </div>
);

const Empty: React.FC = () => <p className="py-2 text-xs text-slate-500">No completed work yet.</p>;

/** Step 3: what was actually done, read from the work that did it. Not a list to tick. */
const ExecutionRecap: React.FC<{ plan: ExecutionPlan; onContinue?: () => void }> = ({ plan, onContinue }) => {
  const [reading, setReading] = useState<'action' | 'person'>('action');
  const recap = plan.recap;
  const outcome = plan.outcome;
  const additional = recap.filter((entry) => entry.kind === 'technician');
  const resolutions = recap.filter((entry) => entry.kind === 'object' || entry.kind === 'cancelled');

  const byPerson = new Map<string, { title: string; hint: string; entries: RecapEntry[] }>();
  for (const entry of recap) {
    if ((entry.kind === 'object' || entry.kind === 'cancelled') && !entry.subject_key) continue;
    const key = entry.subject_key ?? entry.work_order;
    const found = byPerson.get(key) ?? { title: entry.subject ?? entry.title, hint: entry.department ?? '', entries: [] };
    found.entries.push(entry);
    byPerson.set(key, found);
  }

  return (
    <div className="space-y-3">
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
        <Figure value={outcome.requested_done} label="Completed requested work" />
        <Figure value={outcome.unresolved_accepted} label="Unresolved" />
        <Figure value={outcome.technician_done} label="Additional actions" />
        <Figure
          value={outcome.requested_client_users_resolved + outcome.requested_devices_resolved}
          label="Requested entities resolved"
        />
      </div>

      {reading === 'action' ? (
        <>
          {plan.action_groups
            .filter((group) => group.origin !== 'Technician')
            .map((group) => {
              const entries = recap.filter(
                (entry) => entry.kind === 'requested' && entry.action_group_key === group.group_key
              );
              return (
                <Block
                  key={group.group_key ?? group.label}
                  title={group.label}
                  aside={<span className="text-[11px] font-semibold text-slate-500">{entries.length} completed</span>}
                >
                  {entries.length ? (
                    entries.map((entry) => <Line key={entry.work_order} entry={entry} label={entry.subject ?? entry.title} />)
                  ) : (
                    <Empty />
                  )}
                </Block>
              );
            })}
          {recap
            .filter(
              (entry) =>
                entry.kind === 'requested' &&
                !plan.action_groups.some((group) => group.group_key && group.group_key === entry.action_group_key)
            )
            .map((entry) => (
              <Block key={entry.work_order} title={entry.title}>
                <Line entry={entry} label={entry.subject ?? entry.title} />
              </Block>
            ))}
          {additional.length > 0 && (
            <Block
              title="Additional technician work"
              aside={<span className={`${compactBadge} ${TAG.technician.tone}`}>{TAG.technician.label}</span>}
            >
              {additional.map((entry) => (
                <Line key={entry.work_order} entry={entry} label={entry.title} />
              ))}
            </Block>
          )}
        </>
      ) : byPerson.size ? (
        [...byPerson.entries()].map(([key, person]) => (
          <Block key={key} title={person.title} aside={<span className="text-[11px] text-slate-500">{person.hint}</span>}>
            {person.entries.map((entry) => (
              <Line key={entry.work_order} entry={entry} label={entry.title} />
            ))}
          </Block>
        ))
      ) : (
        <Empty />
      )}

      {(plan.requested_entities.length > 0 || resolutions.length > 0) && (
        <Block title="Requested entities">
          {plan.requested_entities.map((entity) => {
            const resolution = resolutions.find((entry) => entry.work_order === entity.name);
            return (
              <div key={entity.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">{entity.display_name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {[
                      entity.context_label,
                      entity.resolved_to?.label,
                      resolution?.title,
                      resolution?.kind === 'cancelled' ? resolution.detail : null,
                      fmtStamp(resolution?.at ?? null),
                      resolution?.by,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {resolution?.kind === 'cancelled' && resolution.reason && (
                    <p className="mt-0.5 text-[11px] text-slate-700">{resolution.reason}</p>
                  )}
                </div>
                <span className={badgeClass(toneOfBadge(entity.badge))}>{entity.badge}</span>
              </div>
            );
          })}
          {resolutions
            .filter((entry) => !plan.requested_entities.some((entity) => entity.name === entry.work_order))
            .map((entry) => (
              <Line key={entry.work_order} entry={entry} label={entry.title} />
            ))}
        </Block>
      )}

      {onContinue && (
        <div className="flex flex-col items-stretch justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500">Recap is derived from persisted Work Orders and resolved Requested records.</p>
          <button type="button" onClick={onContinue} className={primaryButton}>
            Continue to Final validation
          </button>
        </div>
      )}
    </div>
  );
};

export default ExecutionRecap;
