import { Link } from 'react-router-dom';
import type { FulfilmentOutcomePresentation } from './types';
import { badgeClass, linkButtonClass, sectionClass, sectionHeadClass, toneOfBadge } from './format';

type Props = {
  outcome: FulfilmentOutcomePresentation;
  onViewExecutionRecap?: () => void;
};

const row =
  'grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-4';

const pathOf = (link: NonNullable<FulfilmentOutcomePresentation['entities'][number]['link']>) =>
  link.doctype === 'MSP Client User'
    ? `/msp/users/${encodeURIComponent(link.name)}`
    : `/msp/devices/${encodeURIComponent(link.name)}`;

export default function FulfilmentOutcomeSummary({ outcome, onViewExecutionRecap }: Props) {
  return (
    <section className={sectionClass} aria-label="Fulfilment outcome" data-section="fulfilment-outcome">
      <div className={sectionHeadClass}>
        <h2 className="text-sm font-semibold text-slate-900">Fulfilment outcome</h2>
        <span className="text-[11px] text-slate-400">Persisted execution result</span>
      </div>
      <div className="divide-y divide-slate-100">
        {outcome.entities.map((entity, index) => (
          <div key={`${entity.kind}-${entity.display_name}-${index}`} className={row}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{entity.display_name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{entity.context_label}</p>
            </div>
            <div>
              <span className={badgeClass(toneOfBadge(entity.badge))}>{entity.badge}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">{entity.resolved_label || '—'}</p>
              {entity.resolved_note && <p className="mt-0.5 text-xs text-slate-500">{entity.resolved_note}</p>}
            </div>
            <div className="md:text-right">
              {entity.link && (
                <Link to={pathOf(entity.link)} className={linkButtonClass}>
                  {entity.link.doctype === 'MSP Client User' ? 'View Client User' : 'View Device'}
                </Link>
              )}
            </div>
          </div>
        ))}

        <div className={row}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Requested work</p>
            <p className="mt-0.5 text-xs text-slate-500">Final execution summary</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">{outcome.work.completed} completed</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {outcome.work.unresolved} unresolved
              {outcome.work.cancelled ? ` · ${outcome.work.cancelled} cancelled` : ''}
            </p>
          </div>
          <div>
            <span className={badgeClass(toneOfBadge(outcome.work.badge))}>{outcome.work.badge}</span>
          </div>
          <div className="md:text-right">
            {onViewExecutionRecap && (
              <button type="button" onClick={onViewExecutionRecap} className={linkButtonClass}>
                View execution recap
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
