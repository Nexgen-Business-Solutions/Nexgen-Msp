import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  CircleX,
  Laptop,
  PauseCircle,
  PencilLine,
  PlayCircle,
  Plus,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import RemarkLog from '@/shared/components/RemarkLog';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useSession } from '@/shared/hooks/useSession';
import { isAdmin as hasAdminRole } from '@/shared/layout/navigation';
import AddDeviceModal from '../components/AddDeviceModal';
import AddUserServiceModal from '../components/AddUserServiceModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import EditClientUserModal from '../components/EditClientUserModal';
import UserStatusModal from '../components/UserStatusModal';
import TransferDeviceModal from '../components/TransferDeviceModal';
import RepossessDeviceModal from '../components/RepossessDeviceModal';
import ServiceActionModal, { type ServiceAction } from '../components/ServiceActionModal';
import UserAttentionPanel from '../components/UserAttentionPanel';
import UserHistoryPanel from '../components/UserHistoryPanel';
import UserIdentityCard from '../components/UserIdentityCard';
import UserOpenRequests from '../components/UserOpenRequests';
import {
  userKeys,
  useCustomerRequests,
  useDeleteClientUser,
  useUserDetail,
} from '../hooks/useUsers';
import { useMyApprovalRights, usePortalUserFile } from '@/features/portal/hooks/usePortal';
import { useDeviceFilterOptions } from '../hooks/useDevices';
import type { HeldDevice, UserServiceEntry } from '@/lib/api/internal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'Never');

const Panel = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {action}
    </div>
    <div className="mt-2">{children}</div>
  </section>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:rounded-l-lg last:rounded-r-lg">
    {children}
  </th>
);

const Empty = ({ span, children }: { span: number; children: React.ReactNode }) => (
  <tr>
    <td colSpan={span} className="px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </td>
  </tr>
);

/**
 * One person's situation, and what Nexgen can do about it straight away: their services and
 * their machines as tables, each with its direct actions. Opening a request is the customer's
 * way in; Nexgen acts.
 */
export default function UserDetail({ portal = false }: { portal?: boolean } = {}) {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const ours = useUserDetail(portal ? undefined : name);
  const theirs = usePortalUserFile(portal ? name : undefined);
  const detail = portal ? theirs : ours;
  const canAct = !portal;
  const rights = useMyApprovalRights(portal);
  const mayAsk = rights.data?.can_submit !== false;
  const remove = useDeleteClientUser();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [addingDevice, setAddingDevice] = useState(false);
  const [deviceService, setDeviceService] = useState<string | null>(null);
  const [applying, setApplying] = useState<{
    service: UserServiceEntry;
    device: HeldDevice | null;
    action: ServiceAction;
  } | null>(null);
  const [moving, setMoving] = useState<{ device: HeldDevice; kind: 'transfer' | 'repossess' } | null>(null);

  // the request list a citation field offers, fetched by the forms that want it
  const customerRequests = useCustomerRequests(portal ? null : detail.data?.user.customer);
  const deviceOptions = useDeviceFilterOptions(canAct);

  const { data: session } = useSession();
  const isAdmin = canAct && hasAdminRole(session?.roles);
  // a contact who is kept away from invoices is kept away from billing dates too
  const seesBilling = canAct || session?.can_see_invoices !== false;

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'User not found.'}
        </div>
      </div>
    );
  }

  const data = detail.data;
  const { user } = data;

  const openRequest = (request: string) => navigate(`/msp/requests/${request}`);

  const services = [
    ...data.personal_services.current.map((service) => ({ service, device: null as HeldDevice | null })),
    ...data.devices.flatMap((slot) => slot.services.current.map((service) => ({ service, device: slot }))),
  ];

  const serviceActions = (service: UserServiceEntry, device: HeldDevice | null): RowAction[] => {
    const status = service.operational_status;
    const act = (action: ServiceAction) => () => setApplying({ service, device, action });

    return [
      { label: 'Suspend', icon: PauseCircle, onClick: act('Suspend'), disabled: status !== 'Active' },
      { label: 'Resume', icon: PlayCircle, onClick: act('Resume'), disabled: status !== 'Suspended' },
      { label: 'Change', icon: PencilLine, onClick: act('Change'), disabled: !['Active', 'Suspended'].includes(status) },
      {
        label: 'Close',
        icon: CircleX,
        onClick: act('End'),
        danger: true,
        disabled: !['Active', 'Suspended', 'Pending Removal'].includes(status),
      },
    ];
  };

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/users')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to users
      </button>

      <UserIdentityCard
        detail={data}
        isAdmin={isAdmin}
        readOnly={portal}
        actions={
          portal && mayAsk ? (
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/new?client_user=${encodeURIComponent(user.name)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={14} />
              Raise a request
            </button>
          ) : undefined
        }
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
        onStatus={() => setChangingStatus(true)}
      />

      {canAct && <UserAttentionPanel signals={data.attention} />}

      <UserOpenRequests requests={data.open_requests} onOpen={openRequest} />

      <Panel
        title={`Services · ${services.length} open`}
        action={
          canAct ? (
          <button
            type="button"
            onClick={() => setAddingService(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus size={13} />
            Add service
          </button>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <Th>Service</Th>
                <Th>Device</Th>
                <Th>Since</Th>
                {seesBilling && <Th>Last billed</Th>}
                {seesBilling && <Th>Billing</Th>}
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.length === 0 && (
                <Empty span={seesBilling ? 7 : 5}>No open service for {user.full_name}.</Empty>
              )}
              {services.map(({ service, device }) => (
                <tr key={service.name} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {service.service_name}
                    {service.pending_request && (
                      <button
                        type="button"
                        onClick={() => openRequest(service.pending_request as string)}
                        className="mt-0.5 flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      >
                        In request {service.pending_request}
                        <ArrowUpRight size={11} />
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {device ? device.device.hostname : 'N/A'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(service.effective_start_date)}
                  </td>
                  {seesBilling && (
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {service.last_billed_on ? fmtDate(service.last_billed_on) : 'Never'}
                    </td>
                  )}
                  {seesBilling && (
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {service.billing_status || 'N/A'}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={service.operational_status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end">
                      {canAct && <RowActionsMenu actions={serviceActions(service, device)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={`Devices · ${data.devices.length}`}
        action={
          canAct ? (
          <button
            type="button"
            onClick={() => setAddingDevice(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus size={13} />
            Assign a device
          </button>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <Th>Hostname</Th>
                <Th>Device Type</Th>
                <Th>Network interfaces</Th>
                <Th>Serial Number</Th>
                <Th>Held since</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.devices.length === 0 && (
                <Empty span={7}>
                  <span className="inline-flex items-center gap-1.5">
                    <Laptop size={15} className="text-slate-400" />
                    {user.full_name} currently holds no device.
                  </span>
                </Empty>
              )}
              {data.devices.map((slot) => (
                <tr key={slot.device.name} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {slot.device.hostname}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {slot.device.device_type || 'N/A'}
                  </td>
                  <td className="px-4 py-3">
                    {slot.interfaces.length ? (
                      <div className="space-y-0.5">
                        {slot.interfaces.map((item) => (
                          <div key={`${item.interface_type}-${item.mac_address}`} className="flex items-baseline gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              {item.interface_type}
                            </span>
                            <span className="font-mono text-xs text-slate-800">{item.mac_address}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">N/A</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {slot.device.serial_number ? (
                      <span className="font-mono text-xs text-slate-800">{slot.device.serial_number}</span>
                    ) : (
                      <span className="text-amber-600">Missing</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(slot.holder_since)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={slot.device.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={[
                          ...(canAct
                            ? [
                                { label: 'Add service', icon: ShieldCheck, onClick: () => setDeviceService(slot.device.name) },
                                { label: 'Transfer to someone else', icon: ArrowRightLeft, onClick: () => setMoving({ device: slot, kind: 'transfer' }) },
                                { label: 'Return to stock', icon: Undo2, onClick: () => setMoving({ device: slot, kind: 'repossess' }) },
                              ]
                            : []),
                          { label: 'Open device', icon: Laptop, onClick: () => navigate(`/msp/devices/${slot.device.name}`) },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      

      <div className="grid gap-4 lg:grid-cols-2">
        {seesBilling && (
        <Panel title="Billing & coverage">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-400">Billed up to</dt>
              <dd className="text-slate-700">{fmtDate(data.billing.covered_until)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Last billed on</dt>
              <dd className="text-slate-700">{fmtDate(data.billing.last_billed_on)}</dd>
            </div>
          </dl>
        </Panel>
        )}

        {canAct && (
        <Panel title="Internal notes">
          <RemarkLog
            entries={data.notes?.log ?? []}
            target={{ doctype: 'MSP Client User', name: user.name }}
            invalidate={userKeys.detail(user.name)}
          />
        </Panel>
        )}
      </div>
      <UserHistoryPanel name={user.name} recent={data.recent_activity} portal={portal} />

      {canAct && (
      <>
      <AddUserServiceModal
        open={addingService}
        user={user}
        requests={customerRequests.data ?? []}
        onClose={() => setAddingService(false)}
      />

      <DeviceServiceModal device={deviceService} onClose={() => setDeviceService(null)} />

      <AddDeviceModal
        open={addingDevice}
        clientUser={user.name}
        userName={user.full_name}
        customer={user.customer}
        deviceTypes={deviceOptions.data?.device_types ?? []}
        interfaceTypes={deviceOptions.data?.interface_types ?? []}
        requests={customerRequests.data ?? []}
        onClose={() => setAddingDevice(false)}
      />

      <ServiceActionModal
        clientUser={user.name}
        target={
          applying
            ? {
                row: {
                  name: applying.service.name,
                  service_item: applying.service.service_item,
                  service_name: applying.service.service_name,
                  assignment_scope: applying.device ? 'Device' : 'User',
                  managed_device: applying.device?.device.name ?? null,
                  hostname: applying.device?.device.hostname ?? null,
                  operational_status: applying.service.operational_status,
                  billing_status: applying.service.billing_status ?? '',
                  effective_start_date: applying.service.effective_start_date,
                  effective_end_date: applying.service.effective_end_date,
                  source_request: applying.service.source_request,
                  device_serial_number: applying.device?.device.serial_number ?? null,
                  device_user_name: user.full_name,
                  last_billed_on: applying.service.last_billed_on ?? null,
                },
                action: applying.action,
              }
            : null
        }
        requests={customerRequests.data ?? []}
        onClose={() => setApplying(null)}
      />

      <TransferDeviceModal
        open={moving?.kind === 'transfer'}
        device={moving?.device.device.name ?? ''}
        hostname={moving?.device.device.hostname ?? ''}
        serialNumber={moving?.device.device.serial_number}
        customer={user.customer}
        currentHolder={user.name}
        currentHolderName={user.full_name}
        heldSince={moving?.device.holder_since}
        onClose={() => setMoving(null)}
      />

      <RepossessDeviceModal
        open={moving?.kind === 'repossess'}
        device={moving?.device.device.name ?? ''}
        hostname={moving?.device.device.hostname ?? ''}
        serialNumber={moving?.device.device.serial_number}
        currentHolder={user.name}
        currentHolderName={user.full_name}
        onClose={() => setMoving(null)}
      />

      <EditClientUserModal open={editing} user={user} onClose={() => setEditing(false)} />

      <UserStatusModal
        open={changingStatus}
        detail={data}
        onClose={() => setChangingStatus(false)}
      />

      <ConfirmModal
        open={deleting}
        title={`Delete ${user.full_name}?`}
        description="This erases the person and everything recorded against them. It cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isLoading}
        error={(remove.error as Error)?.message}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await remove.mutateAsync(user.name);
          navigate('/msp/users');
        }}
      />
      </>
      )}
    </div>
  );
}
