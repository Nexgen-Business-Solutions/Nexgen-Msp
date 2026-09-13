import type { WorkflowStep } from '@/shared/components/WorkflowStepper';

/** Steps walked in order: those before are done, the one reached is current. */
export const stepsInOrder = (labels: { key: string; label: string }[], currentIndex: number) =>
  labels.map<WorkflowStep>((entry, index) => ({
    ...entry,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }));
