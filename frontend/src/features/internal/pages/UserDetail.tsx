import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CircleX,
  Eye,
  Laptop,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RemarkLog from '@/shared/components/RemarkLog';
import { useSession } from '@/shared/hooks/useSession';
import { isAdmin as hasAdminRole } from '@/shared/layout/navigation';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import AddUserServiceModal from '../components/AddUserServiceModal';
import ServiceActionModal, { type ServiceAction } from '../components/ServiceActionModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import AddDeviceModal from '../components/AddDeviceModal';
import EditClientUserModal from '../components/EditClientUserModal';
import {
  userKeys,
  useDeleteClientUser,
  useUserDetail,
  useUserServiceAvailability,
} from '../hooks/useUsers';
import { useDeviceServiceAvailability } from '../hooks/useDevices';
import ConfirmModal from '@/shared/components/ConfirmModal';

import type {
  ServiceAvailabilityCurrent,
  UserDevice,
  UserServiceRow as UserServiceRowType,
} from '@/lib/api/internal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const INTERFACE_ORDER = ['Wi-Fi', 'LAN', 'Extra', 'Other'];

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

const Panel = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {action}
    </div>
    <div className="max-h-[26rem] overflow-auto px-5 pb-4">{children}</div>
  </div>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:rounded-l-lg last:rounded-r-lg">
    {children}
  </th>
);

const Empty = ({ span, children }: { span: number; children: React.ReactNode }) => (
  <tr>
    <td colSpan={span} className="px-4 py-10 text-center text-sm text-slate-500">
      {children}
    </td>
  </tr>
);

type ServiceTarget = { row: UserServiceRowType; action: ServiceAction };

/** The availability payload names an open period; the action modal reads a service row. */
const toServiceRow = (
  entry: ServiceAvailabilityCurrent,
  device?: UserDevice | null
): UserServiceRowType => ({
  name: entry.name,
  service_item: entry.service_item,
  service_name: entry.item_name,
  assignment_scope: device ? 'Device' : 'User',
  managed_device: device?.name ?? null,
  hostname: device?.hostname ?? null,
  operational_status: entry.operational_status,
  billing_status: entry.billing_status,
  effective_start_date: entry.effective_start_date,
  effective_end_date: null,
  source_request: null,
});

const actionClass =
  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors';

const ServiceLine = ({
  row,
  onAction,
}: {
  row: UserServiceRowType;
  onAction: (target: ServiceTarget) => void;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{row.service_name}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        {row.operational_status} since {fmtDate(row.effective_start_date)}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {row.operational_status === 'Active' && (
        <button
          type="button"
          onClick={() => onAction({ row, action: 'Suspend' })}
          className={`${actionClass} border-amber-200 bg-white text-amber-700 hover:bg-amber-50`}
        >
          <PauseCircle size={13} />
          Suspend
        </button>
      )}
      {row.operational_status === 'Suspended' && (
        <button
          type="button"
          onClick={() => onAction({ row, action: 'Resume' })}
          className={`${actionClass} border-blue-200 bg-white text-blue-700 hover:bg-blue-50`}
        >
          <PlayCircle size={13} />
          Resume
        </button>
      )}
      <button
        type="button"
        onClick={() => onAction({ row, action: 'End' })}
        className={`${actionClass} border-red-200 bg-white text-red-600 hover:bg-red-50`}
      >
        <CircleX size={13} />
        Close
      </button>
    </div>
  </div>
);

/** One machine this person holds today, read for what it alone carries. */
const DeviceServicesCard = ({
  device,
  onAddService,
  onAction,
}: {
  device: UserDevice;
  onAddService: () => void;
  onAction: (target: ServiceTarget) => void;
}) => {
  const availability = useDeviceServiceAvailability(device.name);
  const rows = availability.data?.current ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Laptop size={14} className="text-slate-400" />
            {device.hostname}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {device.serial_number ? `Serial: ${device.serial_number}` : 'Serial: missing'} ·{' '}
            {device.status} · held since {fmtDate(device.assigned_date)}
          </p>
        </div>
        <button
          type="button"
          onClick={onAddService}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Plus size={13} />
          Add service
        </button>
      </div>

      {availability.isLoading && (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>
      )}

      {!!availability.error && (
        <p className="px-4 py-6 text-center text-sm text-red-600">
          {(availability.error as Error)?.message || 'Failed to read this device.'}
        </p>
      )}

      {availability.data && rows.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          No service open on this device.
        </p>
      )}

      <div className="divide-y divide-slate-100">
        {rows.map((entry) => (
          <ServiceLine key={entry.name} row={toServiceRow(entry, device)} onAction={onAction} />
        ))}
      </div>
    </div>
  );
};

export default function UserDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referencedRequest = searchParams.get('ref') ?? undefined;
  const wantsNewDevice = searchParams.get('device') === 'new';
  const detail = useUserDetail(name);
  const availability = useUserServiceAvailability(name);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteClientUser();

  const { data: session } = useSession();
  // only an administrator hands out portal access
  const isAdmin = hasAdminRole(session?.roles);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceService, setDeviceService] = useState<string | null>(null);

  useEffect(() => {
    if (wantsNewDevice) setDeviceOpen(true);
  }, [wantsNewDevice]);
  const [target, setTarget] = useState<ServiceTarget | null>(null);

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

  const { user, devices, requests, device_types, interface_types } = detail.data;

  // every row the endpoint returns for a person is a User-scope period on that person
  const personalServices = availability.data?.current ?? [];
  // a device service belongs to the machine, and is read only where the machine is held today
  const heldDevices = devices.filter((device) => device.assigned_client_user === user.name);

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/users')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to users
      </button>

      {referencedRequest && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
          <p className="text-sm text-blue-800">
            Working in reference to{' '}
            <span className="font-semibold">{referencedRequest}</span> — every action here will cite
            it.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/msp/requests/${referencedRequest}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
          >
            Back to the request
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="min-w-0">
                <h1 className="text-lg font-bold text-slate-900">{user.full_name}</h1>
                {user.email && (
                  <p className="mt-0.5 text-sm text-slate-400">{user.email}</p>
                )}
              </span>
              <StatusBadge value={user.lifecycle_status} />
              <button
                type="button"
                onClick={() => setEditingUser(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <Pencil size={13} />
                Edit details
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setDeleting(true)}
                  disabled={!user.can_delete}
                  title={
                    user.can_delete
                      ? 'Erase this person'
                      : `Cannot be deleted: ${user.delete_blockers.join(', ')}`
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <div>
                <p className="text-xs font-medium text-slate-400">Username</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  {user.username || <span className="text-amber-600">Not recorded</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Email</p>
                <p className="mt-0.5 text-sm text-slate-700">{user.email}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Customer</p>
                <p className="mt-0.5 text-sm text-slate-700">{user.customer}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Department</p>
                <p className="mt-0.5 text-sm text-slate-700">{user.department || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">In service since</p>
                <p className="mt-0.5 text-sm text-slate-700">{fmtDate(user.start_date)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Billed up to</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  {user.covered_until ? fmtDate(user.covered_until) : 'Never billed'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Last billed on</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  {user.last_billed_on ? fmtDate(user.last_billed_on) : 'Never'}
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>

      <Panel title="Remarks">
        <RemarkLog
          entries={user.remark_log}
          target={{ doctype: 'MSP Client User', name: user.name }}
          invalidate={userKeys.detail(user.name)}
        />
      </Panel>

      <Panel
        title="Personal services"
        action={
          <button
            type="button"
            onClick={() => setAddServiceOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus size={14} />
            Add service
          </button>
        }
      >
        {availability.isLoading && (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        )}

        {!!availability.error && (
          <p className="py-8 text-center text-sm text-red-600">
            {(availability.error as Error)?.message || 'Failed to read this person’s services.'}
          </p>
        )}

        {availability.data && personalServices.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No personal service open for {user.full_name}.
          </p>
        )}

        <div className="divide-y divide-slate-100">
          {personalServices.map((entry) => (
            <ServiceLine key={entry.name} row={toServiceRow(entry)} onAction={setTarget} />
          ))}
        </div>
      </Panel>

      <Panel title="Device services">
        {heldDevices.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Laptop size={15} className="text-slate-400" />
              No device currently held by this user.
            </span>
          </p>
        ) : (
          <div className="space-y-3">
            {heldDevices.map((device) => (
              <DeviceServicesCard
                key={device.name}
                device={device}
                onAddService={() => setDeviceService(device.name)}
                onAction={setTarget}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Devices"
        action={
          <button
            type="button"
            onClick={() => setDeviceOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus size={14} />
            Add device
          </button>
        }
      >
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              <Th>Hostname</Th>
              <Th>Type</Th>
              <Th>Network interfaces</Th>
              <Th>Serial number</Th>
              <Th>Assigned</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {devices.length === 0 && (
              <Empty span={7}>
                <span className="inline-flex items-center gap-1.5">
                  <Laptop size={15} className="text-slate-400" />
                  No device assigned to this user.
                </span>
              </Empty>
            )}
            {devices.map((device) => (
              <tr key={device.name} className="transition-colors hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                  {device.hostname}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {device.device_type}
                </td>
                <td className="px-4 py-3">
                  {device.interfaces?.length ? (
                    <div className="space-y-1">
                      {[...device.interfaces]
                        .sort(
                          (a, b) =>
                            INTERFACE_ORDER.indexOf(a.interface_type) -
                            INTERFACE_ORDER.indexOf(b.interface_type)
                        )
                        .map((item) => (
                          <div
                            key={`${item.interface_type}-${item.mac_address}`}
                            className="flex items-baseline gap-3"
                          >
                            <span className="w-[5.5rem] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              {INTERFACE_LABEL[item.interface_type] ?? item.interface_type}
                            </span>
                            <span className="font-mono text-xs tracking-tight text-slate-800">
                              {item.mac_address}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">N/A</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {device.serial_number ? (
                    <span className="font-mono text-xs tracking-tight text-slate-800">
                      {device.serial_number}
                    </span>
                  ) : (
                    <span className="text-amber-600">Missing</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(device.assigned_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={device.status} />
                  {device.retired_date && (
                    <p className="mt-1 text-xs text-slate-400">
                      since {fmtDate(device.retired_date)}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex justify-end">
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'Add service',
                          icon: ShieldCheck,
                          onClick: () => setDeviceService(device.name),
                          disabled: device.assigned_client_user !== user.name,
                        },
                        {
                          label: 'Manage device',
                          icon: Laptop,
                          onClick: () =>
                            navigate(`/msp/devices?q=${encodeURIComponent(device.hostname)}`),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Request history">
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              <Th>Request</Th>
              <Th>Type</Th>
              <Th>Priority</Th>
              <Th>Raised</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.length === 0 && <Empty span={6}>No request for this user yet.</Empty>}
            {requests.map((row) => (
              <tr
                key={row.name}
                onClick={() => navigate(`/msp/requests/${row.name}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                  {row.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={row.request_type} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={row.priority} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {fmtDate(row.creation)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex justify-end">
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'View request',
                          icon: Eye,
                          onClick: () => navigate(`/msp/requests/${row.name}`),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <DeviceServiceModal device={deviceService} onClose={() => setDeviceService(null)} />

      <EditClientUserModal
        open={editingUser}
        user={user}
        onClose={() => setEditingUser(false)}
      />

      <AddDeviceModal
        open={deviceOpen}
        clientUser={user.name}
        userName={user.full_name}
        customer={user.customer}
        deviceTypes={device_types}
        interfaceTypes={interface_types}
        requests={detail.data.customer_requests}
        defaultRequest={referencedRequest}
        onClose={() => setDeviceOpen(false)}
      />

      <ConfirmModal
        open={deleting}
        tone="danger"
        title={`Delete ${user.full_name}?`}
        description="They carry nothing — no service, no device, no request, no billed line. This cannot be undone."
        confirmLabel="Delete"
        loading={remove.isLoading}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await remove.mutateAsync(user.name);
          navigate('/msp/users');
        }}
      />

      <AddUserServiceModal
        open={addServiceOpen}
        user={user}
        requests={detail.data.customer_requests}
        defaultRequest={referencedRequest}
        onClose={() => setAddServiceOpen(false)}
      />

      <ServiceActionModal
        clientUser={user.name}
        target={target}
        requests={detail.data.customer_requests}
        defaultRequest={referencedRequest}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
