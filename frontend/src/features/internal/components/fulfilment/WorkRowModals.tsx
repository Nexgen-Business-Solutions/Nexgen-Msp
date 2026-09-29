import React, { useMemo } from 'react';
import type { PersonFacts, UserDetail, UserServiceRow, WorkCard } from '@/lib/api/internal';
import AddDeviceModal from '../AddDeviceModal';
import AddUserServiceModal from '../AddUserServiceModal';
import DeviceServiceModal from '../DeviceServiceModal';
import EditClientUserModal from '../EditClientUserModal';
import RepossessDeviceModal from '../RepossessDeviceModal';
import ServiceActionModal from '../ServiceActionModal';
import StopAllServicesModal from '../StopAllServicesModal';
import TransferDeviceModal from '../TransferDeviceModal';
import UserStatusModal from '../UserStatusModal';
import { useCustomerRequests } from '../../hooks/useUsers';
import { useDeviceFilterOptions } from '../../hooks/useDevices';
import type { WorkRowIntent } from '../../lib/workRowMenu';

type Props = {
  intent: WorkRowIntent | null;
  request: string;
  customer: string;
  people?: Record<string, PersonFacts>;
  onClose: () => void;
  onActivity: (subjectKey: string, activity: { label: string; detail?: string }) => void;
};

const OPEN = ['Active', 'Suspended'];

const userOf = (
  clientUser: string,
  card: WorkCard,
  facts: PersonFacts | null,
  customer: string
): UserDetail['user'] => ({
  name: clientUser,
  full_name: facts?.full_name ?? card.target.label,
  department: facts?.department ?? null,
  customer,
  email: facts?.email ?? null,
  username: facts?.username ?? null,
  lifecycle_status: facts?.lifecycle_status ?? 'Active',
  start_date: facts?.start_date ?? null,
  disabled_date: facts?.disabled_date ?? null,
});

const statusDetailOf = (user: UserDetail['user'], facts: PersonFacts | null) => {
  const open = (facts?.services ?? []).filter((service) => OPEN.includes(service.status));

  return {
    user,
    summary: {
      current_devices: facts?.devices.length ?? 0,
      active_personal_services: open.filter((service) => service.assignment_scope !== 'Device').length,
      active_device_services: open.filter((service) => service.assignment_scope === 'Device').length,
      open_requests: facts?.open_requests.length ?? 0,
      attention_count: 0,
    },
  } as UserDetail;
};

const serviceRowOf = (card: WorkCard): UserServiceRow => ({
  name: card.current?.name ?? card.source_service_assignment ?? '',
  service_item: card.service_item ?? '',
  service_name: card.service_name ?? card.service_item ?? '',
  assignment_scope: card.target_scope ?? 'User',
  managed_device: card.managed_device,
  hostname: card.device?.hostname ?? null,
  operational_status: card.current?.operational_status ?? '',
  billing_status: '',
  effective_start_date: card.current?.effective_start_date ?? null,
  effective_end_date: card.current?.effective_end_date ?? null,
  source_request: null,
  device_serial_number: card.device?.serial_number ?? null,
  device_user_name: card.device?.holder_name ?? null,
  last_billed_on: card.current?.billed_to ?? null,
});

const WorkRowModals: React.FC<Props> = ({ intent, request, customer, people, onClose, onActivity }) => {
  const customerRequests = useCustomerRequests(intent ? customer : null);
  const deviceOptions = useDeviceFilterOptions(Boolean(intent));

  const clientUser = intent && 'clientUser' in intent ? intent.clientUser : '';
  const facts = clientUser ? (people?.[clientUser] ?? null) : null;
  const user = useMemo(
    () => (intent && clientUser ? userOf(clientUser, intent.card, facts, customer) : null),
    [intent, clientUser, facts, customer]
  );
  const person = useMemo(() => (user ? { name: user.name, full_name: user.full_name } : null), [user]);
  const statusDetail = useMemo(() => (user ? statusDetailOf(user, facts) : null), [user, facts]);
  const serviceTarget = useMemo(
    () => (intent?.kind === 'service' ? { row: serviceRowOf(intent.card), action: intent.action } : null),
    [intent]
  );

  if (!intent || intent.kind === 'deviceOpen') return null;

  const requests = customerRequests.data ?? [];
  const card = intent.card;
  const machine =
    'device' in intent
      ? (facts?.devices.find((row) => row.name === intent.device) ??
        (card.device?.name === intent.device ? card.device : null))
      : null;
  const subjectKey = card.subject_key ?? '';

  return (
    <>
      {intent.kind === 'service' && (
        <ServiceActionModal
          clientUser={card.client_user ?? ''}
          target={serviceTarget}
          requests={requests}
          defaultRequest={request}
          onClose={onClose}
        />
      )}

      {(intent.kind === 'deviceAddService' || intent.kind === 'userDeviceService') && (
        <DeviceServiceModal device={intent.device} defaultRequest={request} onClose={onClose} />
      )}

      {intent.kind === 'deviceTransfer' && (
        <TransferDeviceModal
          open
          device={intent.device}
          hostname={card.device?.hostname ?? card.target.label}
          serialNumber={card.device?.serial_number}
          customer={customer}
          currentHolder={card.device?.assigned_client_user ?? card.current_holder ?? null}
          currentHolderName={card.device?.holder_name ?? card.current_holder_name ?? null}
          onClose={onClose}
        />
      )}

      {intent.kind === 'deviceReturn' && (
        <RepossessDeviceModal
          open
          device={intent.device}
          hostname={card.device?.hostname ?? card.target.label}
          serialNumber={card.device?.serial_number}
          currentHolder={card.device?.assigned_client_user ?? card.current_holder ?? null}
          currentHolderName={card.device?.holder_name ?? card.current_holder_name ?? null}
          onClose={onClose}
        />
      )}

      {intent.kind === 'userReturnDevice' && user && (
        <RepossessDeviceModal
          open
          device={intent.device}
          hostname={machine?.hostname ?? intent.device}
          serialNumber={machine?.serial_number}
          currentHolder={user.name}
          currentHolderName={user.full_name}
          onClose={onClose}
        />
      )}

      {intent.kind === 'userAddService' && user && (
        <AddUserServiceModal
          open
          user={user}
          requests={requests}
          defaultRequest={request}
          onClose={onClose}
        />
      )}

      {intent.kind === 'userAssignDevice' && user && (
        <AddDeviceModal
          open
          clientUser={user.name}
          userName={user.full_name}
          customer={customer}
          deviceTypes={deviceOptions.data?.device_types ?? []}
          interfaceTypes={deviceOptions.data?.interface_types ?? []}
          requests={requests}
          defaultRequest={request}
          onClose={onClose}
        />
      )}

      {intent.kind === 'userEdit' && user && (
        <EditClientUserModal
          open
          user={user}
          onClose={onClose}
          onDone={() =>
            onActivity(subjectKey, {
              label: 'User information updated',
              detail: `${user.full_name}'s information was updated.`,
            })
          }
        />
      )}

      {intent.kind === 'userStatus' && statusDetail && (
        <UserStatusModal
          open
          detail={statusDetail}
          onClose={onClose}
          onDone={(activity) => onActivity(subjectKey, activity)}
        />
      )}

      {intent.kind === 'userStopAll' && person && (
        <StopAllServicesModal
          person={person}
          sourceRequest={request}
          onClose={onClose}
        />
      )}
    </>
  );
};

export default WorkRowModals;
