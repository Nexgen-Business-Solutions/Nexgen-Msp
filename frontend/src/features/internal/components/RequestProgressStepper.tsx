import React from 'react';
import WorkflowStepper from '@/shared/components/WorkflowStepper';
import type { WorkStage } from '@/lib/api/internal';

/** The five phases of the job, on one line. Phases nobody needs are visibly passed over. */
const RequestProgressStepper: React.FC<{ stages: WorkStage[]; current: string }> = ({ stages }) => (
  <div className="border-b border-slate-100 bg-white px-6 py-3">
    <WorkflowStepper
      steps={stages.map((stage) => ({ key: stage.key, label: stage.label, state: stage.state }))}
    />
  </div>
);

export default RequestProgressStepper;
