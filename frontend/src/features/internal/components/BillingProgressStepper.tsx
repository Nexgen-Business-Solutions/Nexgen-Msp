import React from 'react';
import WorkflowStepper, { type WorkflowStep } from '@/shared/components/WorkflowStepper';
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

  const steps = STAGES.map<WorkflowStep>((stage, index) => ({
    ...stage,
    state:
      attention === stage.key
        ? 'attention'
        : index < position
          ? 'done'
          : index === position
            ? 'current'
            : 'todo',
  }));

  return (
    <WorkflowStepper
      steps={steps}
      canGo={(key) => Boolean(reachable?.includes(key as BillingStage))}
      onGo={onGo ? (key) => onGo(key as BillingStage) : undefined}
    />
  );
};

export default BillingProgressStepper;
