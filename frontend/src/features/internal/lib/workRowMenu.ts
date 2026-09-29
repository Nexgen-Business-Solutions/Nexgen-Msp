import { CircleX } from 'lucide-react';
import type { PersonFacts, WorkCard } from '@/lib/api/internal';
import type { RequestedEntityPresentation } from '@/lib/api/requestPresentation';
import type { RowAction } from '@/shared/components/RowActionsMenu';
import {
  buildClientUserRowActions,
  buildDeviceRowActions,
  buildServiceAssignmentRowActions,
  type EntityRowAction,
} from '../actions';
import type { ServiceAction } from '../components/ServiceActionModal';
import { isUnresolvedTarget } from './workDisplay';

export type WorkRowIntent =
  | { kind: 'service'; card: WorkCard; action: ServiceAction }
  | { kind: 'deviceAddService'; card: WorkCard; device: string }
  | { kind: 'deviceTransfer'; card: WorkCard; device: string }
  | { kind: 'deviceReturn'; card: WorkCard; device: string }
  | { kind: 'deviceOpen'; card: WorkCard; device: string }
  | { kind: 'userAddService'; card: WorkCard; clientUser: string }
  | { kind: 'userAssignDevice'; card: WorkCard; clientUser: string }
  | { kind: 'userDeviceService'; card: WorkCard; clientUser: string; device: string }
  | { kind: 'userReturnDevice'; card: WorkCard; clientUser: string; device: string }
  | { kind: 'userEdit'; card: WorkCard; clientUser: string }
  | { kind: 'userStatus'; card: WorkCard; clientUser: string }
  | { kind: 'userStopAll'; card: WorkCard; clientUser: string };

export type WorkRowMenu =
  | { kind: 'unresolved' }
  | { kind: 'service' | 'device' | 'client_user'; actions: EntityRowAction[] };

const OPEN = ['Active', 'Suspended'];

const isDeviceTarget = (card: WorkCard) =>
  card.target.kind === 'managed_device' || card.target.kind === 'requested_device';

const touchesAssignment = (card: WorkCard) =>
  Boolean(card.operation_code?.startsWith('service.') && (card.current || card.source_service_assignment));

export const workRowMenu = (
  card: WorkCard,
  people: Record<string, PersonFacts> | undefined,
  open: (intent: WorkRowIntent) => void
): WorkRowMenu => {
  if (isUnresolvedTarget(card)) return { kind: 'unresolved' };

  const exclude = card.primary_action.operation_code || card.operation_code || undefined;

  if (touchesAssignment(card)) {
    const service = (action: ServiceAction) => () => open({ kind: 'service', card, action });

    return {
      kind: 'service',
      actions: buildServiceAssignmentRowActions({
        status: card.current?.operational_status ?? '',
        canWrite: true,
        currentHolding: true,
        onSuspend: service('Suspend'),
        onResume: service('Resume'),
        onChange: service('Change'),
        onEnd: service('End'),
        excludeOperationCode: exclude,
      }),
    };
  }

  if (isDeviceTarget(card) || card.work_type === 'Device Operation') {
    const device = (isDeviceTarget(card) ? card.target.name : null) ?? card.managed_device ?? '';

    return {
      kind: 'device',
      actions: buildDeviceRowActions({
        canWrite: true,
        onAddService: () => open({ kind: 'deviceAddService', card, device }),
        onTransfer: () => open({ kind: 'deviceTransfer', card, device }),
        onReturnToStock: () => open({ kind: 'deviceReturn', card, device }),
        onOpen: () => open({ kind: 'deviceOpen', card, device }),
        excludeOperationCode: exclude,
      }),
    };
  }

  return personMenu(card.target.name ?? card.client_user ?? '', card, people, open, exclude);
};

export const personMenu = (
  clientUser: string,
  card: WorkCard,
  people: Record<string, PersonFacts> | undefined,
  open: (intent: WorkRowIntent) => void,
  exclude?: string
): WorkRowMenu => {
  if (!clientUser) return { kind: 'unresolved' };

  const facts = people?.[clientUser] ?? null;

  return {
    kind: 'client_user',
    actions: buildClientUserRowActions({
      lifecycleStatus: facts?.lifecycle_status ?? null,
      canWrite: true,
      hasOpenPersonalServices: (facts?.services ?? []).some(
        (row) => row.assignment_scope !== 'Device' && OPEN.includes(row.status)
      ),
      devices: (facts?.devices ?? []).map((row) => ({
        name: row.name,
        label: row.hostname ?? row.serial_number ?? row.name,
      })),
      onAddService: () => open({ kind: 'userAddService', card, clientUser }),
      onAssignDevice: () => open({ kind: 'userAssignDevice', card, clientUser }),
      onAddServiceOnDevice: (device) => open({ kind: 'userDeviceService', card, clientUser, device }),
      onReturnDeviceToStock: (device) => open({ kind: 'userReturnDevice', card, clientUser, device }),
      onEdit: () => open({ kind: 'userEdit', card, clientUser }),
      onChangeStatus: () => open({ kind: 'userStatus', card, clientUser }),
      onStopAllServices: () => open({ kind: 'userStopAll', card, clientUser }),
      excludeOperationCode: exclude,
    }),
  };
};

export const entityRowMenu = (entity: RequestedEntityPresentation, onCancel: () => void): RowAction[] =>
  entity.status === 'Open' && entity.name ? [{ label: 'Cancel', icon: CircleX, danger: true, onClick: onCancel }] : [];
