import type { RequestedEntityPresentation } from './types';
import { badgeClass, sectionClass, sectionHeadClass, toneOfBadge } from './format';

export default function RequestedEntitiesSummary({ entities }: { entities: RequestedEntityPresentation[] }) {
  if (!entities.length) return null;

  return (
    <section className={sectionClass} aria-label="Requested entities" data-section="requested-entities">
      <div className={sectionHeadClass}>
        <h2 className="text-sm font-semibold text-slate-900">Requested entities</h2>
        <span className="whitespace-nowrap text-[10px] text-slate-400">Only unresolved/new records</span>
      </div>
      <div className="divide-y divide-slate-100">
        {entities.map((entity) => (
          <div key={entity.key} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{entity.display_name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{entity.context_label}</p>
              </div>
              <span className={`${badgeClass(toneOfBadge(entity.badge))} shrink-0`}>
                {entity.resolved_to ? `${entity.badge} · ${entity.resolved_to.label}` : entity.badge}
              </span>
            </div>
            {entity.status === 'Cancelled' && entity.cancel_reason && (
              <p className="mt-1 text-xs text-slate-600">{entity.cancel_reason}</p>
            )}
            {entity.relationship_summary.length > 0 && (
              <div className="mt-2 space-y-0.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
                {entity.relationship_summary.map((line) => (
                  <p key={line} className="text-[11px] text-slate-600">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
