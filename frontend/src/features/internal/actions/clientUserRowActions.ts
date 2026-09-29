import { CircleX, Laptop, Layers, PencilLine, Undo2, UserCheck, UserX } from 'lucide-react';
import { withoutOperation, type EntityRowAction } from './entityRowAction';

export interface ClientUserRowDevice {
  name: string;
  label: string;
}

export interface ClientUserRowActionsContext {
  lifecycleStatus: string | null | undefined;
  canWrite: boolean;
  hasOpenPersonalServices: boolean;
  devices: ClientUserRowDevice[];
  onAddService: () => void;
  onAssignDevice: () => void;
  onAddServiceOnDevice: (device: string) => void;
  onReturnDeviceToStock: (device: string) => void;
  onEdit: () => void;
  onChangeStatus: () => void;
  onStopAllServices: () => void;
  excludeOperationCode?: string;
}

export const buildClientUserRowActions = ({
  lifecycleStatus,
  canWrite,
  hasOpenPersonalServices,
  devices,
  onAddService,
  onAssignDevice,
  onAddServiceOnDevice,
  onReturnDeviceToStock,
  onEdit,
  onChangeStatus,
  onStopAllServices,
  excludeOperationCode,
}: ClientUserRowActionsContext): EntityRowAction[] => {
  if (!canWrite) return [];

  const disabled = lifecycleStatus === 'Disabled';

  return withoutOperation(
    [
      {
        label: 'Add service',
        icon: Layers,
        onClick: onAddService,
        disabled,
        operationCode: 'service.add',
      },
      {
        label: 'Assign a device',
        icon: Laptop,
        onClick: onAssignDevice,
        disabled,
        operationCode: 'device.assign',
      },
      ...devices.flatMap((device): EntityRowAction[] => [
        {
          label: `Add service on ${device.label}`,
          icon: Layers,
          onClick: () => onAddServiceOnDevice(device.name),
          operationCode: 'service.add',
          operationDevice: device.name,
        },
        {
          label: `Return ${device.label} to stock`,
          icon: Undo2,
          onClick: () => onReturnDeviceToStock(device.name),
          danger: true,
          operationCode: 'device.repossess',
          operationDevice: device.name,
        },
      ]),
      { label: 'Edit', icon: PencilLine, onClick: onEdit },
      disabled
        ? { label: 'Reactivate user', icon: UserCheck, onClick: onChangeStatus }
        : { label: 'Disable user', icon: UserX, onClick: onChangeStatus, danger: true },
      {
        label: 'Stop all services',
        icon: CircleX,
        onClick: onStopAllServices,
        danger: true,
        disabled: !hasOpenPersonalServices,
      },
    ],
    excludeOperationCode
  );
};
