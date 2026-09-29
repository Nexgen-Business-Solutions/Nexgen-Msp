import { CircleX, PauseCircle, PencilLine, PlayCircle } from 'lucide-react';
import { withoutOperation, type EntityRowAction } from './entityRowAction';

export interface ServiceAssignmentRowActionsContext {
  status: string;
  canWrite: boolean;
  currentHolding?: boolean;
  onSuspend: () => void;
  onResume: () => void;
  onChange: () => void;
  onEnd: () => void;
  excludeOperationCode?: string;
}

const OPEN = ['Active', 'Suspended'];

export const buildServiceAssignmentRowActions = ({
  status,
  canWrite,
  currentHolding = true,
  onSuspend,
  onResume,
  onChange,
  onEnd,
  excludeOperationCode,
}: ServiceAssignmentRowActionsContext): EntityRowAction[] => {
  if (!canWrite || !currentHolding) return [];

  return withoutOperation(
    [
      {
        label: 'Suspend',
        icon: PauseCircle,
        onClick: onSuspend,
        disabled: status !== 'Active',
        operationCode: 'service.suspend',
      },
      {
        label: 'Resume',
        icon: PlayCircle,
        onClick: onResume,
        disabled: status !== 'Suspended',
        operationCode: 'service.resume',
      },
      {
        label: 'Change service',
        icon: PencilLine,
        onClick: onChange,
        disabled: !OPEN.includes(status),
        operationCode: 'service.change',
      },
      {
        label: 'Stop service',
        icon: CircleX,
        onClick: onEnd,
        danger: true,
        disabled: !OPEN.includes(status),
        operationCode: 'service.end',
      },
    ],
    excludeOperationCode
  );
};
