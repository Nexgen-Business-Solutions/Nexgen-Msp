import React from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import type { BillingStage } from '../lib/billingStage';

const STAGES: { key: BillingStage; label: string }[] = [
  { key: 'scope', label: 'Scope' },
  { key: 'selection', label: 'Selection' },
  { key: 'validation', label: 'Validation' },
  { key: 'review', label: 'Review' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'complete', label: 'Complete' },
];

type Props = {
  current: BillingStage;
  /** the stage that needs somebody: drawn in amber rather than as plain progress */
  attention?: BillingStage | null;
  onGo?: (stage: BillingStage) => void;
  reachable?: BillingStage[];
};

/**
 * The six phases of a billing run, on one line, from the first question to the invoice.
 *
 * Drawing a run and finishing it used to be two screens that looked like two jobs. They
 * are one job, and this is what says so.
 */
const BillingProgressStepper: React.FC<Props> = ({ current, attention, onGo, reachable }) => {
  const position = STAGES.findIndex((stage) => stage.key === current);

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-5 py-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold text-slate-500 sm:hidden">
        Step {position + 1} of {STAGES.length} · {STAGES[position]?.label}
      </p>

      <ol className="hidden items-center gap-2 sm:flex">
        {STAGES.map((stage, index) => {
          const done = index < position;
          const here = index === position;
          const flagged = attention === stage.key;
          const canGo = Boolean(onGo && reachable?.includes(stage.key));

          return (
            <li key={stage.key} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canGo}
                onClick={() => canGo && onGo?.(stage.key)}
                aria-current={here ? 'step' : undefined}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-default ${
                  flagged
                    ? 'bg-amber-50 text-amber-800'
                    : here
                      ? 'bg-blue-600 text-white'
                      : done
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-slate-400'
                } ${canGo ? 'hover:opacity-80' : ''}`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    flagged
                      ? 'bg-amber-100'
                      : here
                        ? 'bg-white/20'
                        : done
                          ? 'bg-emerald-100'
                          : 'bg-slate-100'
                  }`}
                >
                  {flagged ? (
                    <TriangleAlert size={12} />
                  ) : done ? (
                    <Check size={12} />
                  ) : (
                    index + 1
                  )}
                </span>
                {stage.label}
              </button>
              {index < STAGES.length - 1 && <span className="h-px w-3 bg-slate-200" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default BillingProgressStepper;
