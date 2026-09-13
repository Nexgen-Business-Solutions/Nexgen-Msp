import React from 'react';
import { ArrowLeft } from 'lucide-react';

export const primaryBtn =
  'inline-flex h-10 items-center justify-center gap-1.5 text-nowrap rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300';

export const secondaryBtn =
  'inline-flex h-10 items-center justify-center gap-1.5 text-nowrap rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const quietBtn =
  'inline-flex h-10 items-center justify-center gap-1.5 text-nowrap rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50';

type Props = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** the buttons that move the workflow, on the right */
  actions?: React.ReactNode;
  /** the stepper, drawn under the title in the same panel */
  stepper?: React.ReactNode;
};

/** The top of every workflow: where you are, how to leave, how to move on, and the steps. */
const WorkflowHeader: React.FC<Props> = ({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  actions,
  stepper,
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
    <section className="bg-white">
      <div className="flex flex-col items-start justify-between gap-4 px-6 py-3 md:flex-row">
        <div className="flex shrink-0 items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>

        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {stepper && <div className="px-6 pb-3">{stepper}</div>}
    </section>
  </div>
);

export default WorkflowHeader;
