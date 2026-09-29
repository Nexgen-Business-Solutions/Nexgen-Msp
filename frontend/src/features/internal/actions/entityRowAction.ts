import type { RowAction } from '@/shared/components/RowActionsMenu';

export type OperationCode =
  | 'service.add'
  | 'service.suspend'
  | 'service.resume'
  | 'service.change'
  | 'service.end'
  | 'device.assign'
  | 'device.transfer'
  | 'device.repossess';

export interface EntityRowAction extends RowAction {
  operationCode?: OperationCode;
  operationDevice?: string;
}

export const withoutOperation = (
  actions: EntityRowAction[],
  excludeOperationCode?: string
): EntityRowAction[] =>
  excludeOperationCode
    ? actions.filter(
        (action) =>
          action.operationDevice !== undefined || action.operationCode !== excludeOperationCode
      )
    : actions;
