import React from 'react';
import { Check, Minus } from 'lucide-react';
import type { WorkStage } from '@/lib/api/internal';

const TONE: Record<WorkStage['state'], string> = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  current: 'border-blue-300 bg-blue-50 text-blue-700',
  todo: 'border-slate-200 bg-white text-slate-400',
  skipped: 'border-slate-100 bg-slate-50 text-slate-300',
};

/** The five phases of the job, on one line. Phases nobody needs are visibly passed over. */
const RequestProgressStepper: React.FC<{ stages: WorkStage[]; current: string }> = ({
  stages,
  current,
}) => {
  const position = stages.findIndex((stage) => stage.key === current) + 1;

  return (
    <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-3">
      <p className="mb-2 text-xs font-semibold text-slate-500 sm:hidden">
        Step {position} of {stages.length} · {stages.find((stage) => stage.key === current)?.label}
      </p>

      <ol className="hidden items-center gap-2 sm:flex">
        {stages.map((stage, index) => (
          <li key={stage.key} className="flex items-center gap-2">
            <span
              aria-current={stage.state === 'current' ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                TONE[stage.state]
              }`}
            >
              {stage.state === 'done' && <Check size={12} />}
              {stage.state === 'skipped' && <Minus size={12} />}
              {stage.label}
              {stage.state === 'skipped' && (
                <span className="font-normal">· not needed</span>
              )}
            </span>
            {index < stages.length - 1 && <span className="h-px w-4 bg-slate-200" />}
          </li>
        ))}
      </ol>
    </div>
  );
};

export default RequestProgressStepper;
