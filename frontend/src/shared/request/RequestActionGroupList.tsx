import { useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type {
  RequestActionGroupPresentation,
  RequestRelationship,
  RequestTargetPresentation,
} from './types';
import { badgeClass, linkButtonClass, sectionClass, sectionHeadClass } from './format';

type Props = {
  groups: RequestActionGroupPresentation[];
  defaultExpanded?: boolean;
  renderGroupControls?: (group: RequestActionGroupPresentation) => ReactNode;
  renderTargetControls?: (
    target: RequestTargetPresentation,
    group: RequestActionGroupPresentation
  ) => ReactNode;
};

const th = 'whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const td = 'px-3 py-2 align-top text-sm text-slate-700';

const Relationship = ({ relationship, strong }: { relationship: RequestRelationship; strong?: boolean }) => (
  <div className="min-w-0">
    <p className={strong ? 'text-sm font-semibold text-slate-900' : 'text-xs text-slate-600'}>
      {relationship.from_label ? `${relationship.from_label} → ` : '→ '}
      {relationship.to_label}
      {relationship.to_is_new && <span className={`${badgeClass('amber')} ml-1.5`}>NEW</span>}
    </p>
    {relationship.note && <p className="mt-0.5 text-xs text-slate-500">{relationship.note}</p>}
  </div>
);

const DECISION: Record<string, { label: string; tone: 'emerald' | 'red' | 'slate' | 'amber' }> = {
  Pending: { label: 'PENDING', tone: 'amber' },
  Approved: { label: 'ACCEPTED', tone: 'emerald' },
  Rejected: { label: 'REJECTED', tone: 'red' },
  Cancelled: { label: 'CANCELLED', tone: 'slate' },
};

const decided = (target: RequestTargetPresentation) =>
  Boolean(target.line_status && target.line_status !== 'Pending');

function TargetTable({
  group,
  renderTargetControls,
}: {
  group: RequestActionGroupPresentation;
  renderTargetControls?: Props['renderTargetControls'];
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const single = group.targets.length === 1;
  const withDecision = !single && (Boolean(renderTargetControls) || group.targets.some(decided));
  const changed = group.targets.some((target) => target.state_changed);

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3" data-testid={`targets-${group.group_key}`}>
      {changed && (
        <p className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          Current state has changed since this request was submitted.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Person</th>
              <th className={th}>Target</th>
              <th className={th}>Requested operation</th>
              <th className={th}>State at request time</th>
              {withDecision && <th className={th}>Decision</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {group.targets.map((target, index) => {
              const decision = target.work_cancelled
                ? DECISION.Cancelled
                : target.line_status
                  ? DECISION[target.line_status]
                  : null;

              return (
                <tr key={`${target.line_idx ?? 'draft'}-${index}`} data-line-idx={target.line_idx ?? undefined}>
                  <td className={`${td} font-medium text-slate-900`}>
                    {target.person_label || '—'}
                    {target.person_is_new && <span className={`${badgeClass('amber')} ml-1.5`}>NEW</span>}
                  </td>
                  <td className={td}>
                    {target.target_label}
                    {target.target_badge && (
                      <span className={`${badgeClass('amber')} ml-1.5`}>{target.target_badge}</span>
                    )}
                  </td>
                  <td className={td}>
                    <p>{target.operation_label}</p>
                    {!single && target.relationship && <Relationship relationship={target.relationship} />}
                  </td>
                  <td className={td}>{target.state_at_request || '—'}</td>
                  {withDecision && (
                    <td className={td}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          {decision && (target.line_status !== 'Pending' || !renderTargetControls) && (
                            <span className={badgeClass(decision.tone)}>{decision.label}</span>
                          )}
                          {target.rejection_reason && (
                            <p className="mt-0.5 text-xs text-red-700">{target.rejection_reason}</p>
                          )}
                        </div>
                        {renderTargetControls && (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {renderTargetControls(target, group)}
                          </div>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {group.unchanged.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={showUnchanged}
            onClick={() => setShowUnchanged(!showUnchanged)}
            className={linkButtonClass}
          >
            View unchanged
          </button>
          {showUnchanged && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {group.unchanged.map((row) => (
                <li key={row.subject_key} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{row.person_label}</span>
                  <span className="text-slate-500">{row.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function RequestActionGroupList({
  groups,
  defaultExpanded = false,
  renderGroupControls,
  renderTargetControls,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (group: RequestActionGroupPresentation) =>
    open[group.group_key] ?? (defaultExpanded && group.targets.length !== 1);

  return (
    <section className={sectionClass} aria-label="Requested actions" data-section="requested-actions">
      <div className={sectionHeadClass}>
        <h2 className="text-sm font-semibold text-slate-900">Requested actions</h2>
        <span className="text-[11px] text-slate-400">Request-time snapshot</span>
      </div>

      <div className="divide-y divide-slate-100">
        {groups.map((group) => {
          const only = group.targets.length === 1 ? group.targets[0] : null;
          const relationship = only ? (group.relationship ?? only.relationship) : null;
          const decision = only?.work_cancelled
            ? DECISION.Cancelled
            : only?.line_status
              ? DECISION[only.line_status]
              : null;

          return (
            <div key={group.group_key} data-group={group.group_key}>
              <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{group.operation_label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{group.context_label}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{group.impact_label}</p>
                  {group.impact_detail && <p className="mt-0.5 text-xs text-slate-500">{group.impact_detail}</p>}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {relationship && <Relationship relationship={relationship} strong />}
                  {group.badges.map((badge) => (
                    <span key={badge.label} className={badgeClass(badge.tone)}>
                      {badge.label}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {only && (decided(only) || renderTargetControls) && (
                    <div className="min-w-0" data-decision>
                      {decision && (only.line_status !== 'Pending' || !renderTargetControls) && (
                        <span className={badgeClass(decision.tone)}>{decision.label}</span>
                      )}
                      {only.rejection_reason && (
                        <p className="mt-0.5 text-xs text-red-700">{only.rejection_reason}</p>
                      )}
                    </div>
                  )}
                  {only && renderTargetControls ? renderTargetControls(only, group) : renderGroupControls?.(group)}
                  <button
                    type="button"
                    aria-expanded={isOpen(group)}
                    onClick={() => setOpen({ ...open, [group.group_key]: !isOpen(group) })}
                    className={linkButtonClass}
                  >
                    View details
                  </button>
                </div>
              </div>

              {isOpen(group) && <TargetTable group={group} renderTargetControls={renderTargetControls} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
