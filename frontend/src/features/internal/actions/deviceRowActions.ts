import { ArrowRightLeft, Laptop, ShieldCheck, Undo2 } from 'lucide-react';
import { withoutOperation, type EntityRowAction } from './entityRowAction';

export interface DeviceRowActionsContext {
  canWrite: boolean;
  onAddService: () => void;
  onTransfer: () => void;
  onReturnToStock: () => void;
  onOpen: () => void;
  excludeOperationCode?: string;
}

export const buildDeviceRowActions = ({
  canWrite,
  onAddService,
  onTransfer,
  onReturnToStock,
  onOpen,
  excludeOperationCode,
}: DeviceRowActionsContext): EntityRowAction[] =>
  withoutOperation(
    [
      ...(canWrite
        ? [
            {
              label: 'Add service',
              icon: ShieldCheck,
              onClick: onAddService,
              operationCode: 'service.add' as const,
            },
            {
              label: 'Transfer to someone else',
              icon: ArrowRightLeft,
              onClick: onTransfer,
              operationCode: 'device.transfer' as const,
            },
            {
              label: 'Return to stock',
              icon: Undo2,
              onClick: onReturnToStock,
              operationCode: 'device.repossess' as const,
            },
          ]
        : []),
      { label: 'Open device', icon: Laptop, onClick: onOpen },
    ],
    excludeOperationCode
  );
