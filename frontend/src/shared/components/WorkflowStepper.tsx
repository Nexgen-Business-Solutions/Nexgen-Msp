import React from 'react';
import { Check, Minus, TriangleAlert } from 'lucide-react';

export type WorkflowStepState = 'done' | 'current' | 'todo' | 'attention' | 'skipped';

export type WorkflowStep = {
  key: string;
  label: string;
  state: WorkflowStepState;
};

type Props = {
  steps: WorkflowStep[];
  /** a step that answers true here can be clicked to go back to it */
  canGo?: (key: string) => boolean;
  onGo?: (key: string) => void;
};

const CIRCLE: Record<WorkflowStepState, string> = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  current: 'border-blue-600 bg-blue-600 text-white',
  attention: 'border-amber-500 bg-amber-500 text-white',
  skipped: 'border-dashed border-slate-300 bg-slate-50 text-slate-300',
  todo: 'border-slate-300 bg-white text-slate-400',
};

const LABEL: Record<WorkflowStepState, string> = {
  done: 'text-slate-700',
  current: 'text-blue-700',
  attention: 'text-amber-700',
  skipped: 'text-slate-300',
  todo: 'text-slate-400',
};

const StepContent: React.FC<{ step: WorkflowStep; number: number }> = ({ step, number }) => (
  <>
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
        CIRCLE[step.state]
      }`}
    >
      {step.state === 'done' ? (
        <Check size={13} strokeWidth={3} />
      ) : step.state === 'attention' ? (
        <TriangleAlert size={12} strokeWidth={2.5} />
      ) : step.state === 'skipped' ? (
        <Minus size={12} strokeWidth={3} />
      ) : (
        number
      )}
    </span>
    <span className={`mr-3 text-sm font-medium ${LABEL[step.state]}`}>
      {step.label}
      {step.state === 'skipped' && (
        <span className="ml-1 text-xs font-normal text-slate-300">· not needed</span>
      )}
    </span>
  </>
);

/**
 * Every workflow in the application walks its steps on this one line, drawn the same way.
 *
 * A stepper somebody can move through draws its steps as buttons; one that only reports
 * progress draws them as plain items, so a label is never mistaken for an action.
 */
const WorkflowStepper: React.FC<Props> = ({ steps, canGo, onGo }) => (
  <nav className="flex flex-wrap items-center gap-y-2 md:flex-nowrap md:overflow-x-auto">
    {steps.map((step, index) => {
      const clickable = Boolean(onGo && canGo?.(step.key));
      const here = step.state === 'current' || step.state === 'attention';

      return (
        <React.Fragment key={step.key}>
          {onGo ? (
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onGo(step.key)}
              aria-current={here ? 'step' : undefined}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap py-1 disabled:cursor-default ${
                clickable ? 'cursor-pointer' : ''
              }`}
            >
              <StepContent step={step} number={index + 1} />
            </button>
          ) : (
            <div
              aria-current={here ? 'step' : undefined}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap py-1"
            >
              <StepContent step={step} number={index + 1} />
            </div>
          )}
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className={`mx-4 hidden h-px flex-1 md:block ${
                step.state === 'done' ? 'bg-emerald-300' : 'bg-slate-200'
              }`}
            />
          )}
        </React.Fragment>
      );
    })}
  </nav>
);

export default WorkflowStepper;
