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
  Send,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import { useSession } from '@/shared/hooks/useSession';
import { isAdmin as hasAdminRole } from '@/shared/layout/navigation';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import AssignServiceModal from '../components/AssignServiceModal';
import ServiceActionModal, { type ServiceAction } from '../components/ServiceActionModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import AddDeviceModal from '../components/AddDeviceModal';
import EditClientUserModal from '../components/EditClientUserModal';
import PortalInviteModal from '../components/PortalInviteModal';
import { useUserDetail } from '../hooks/useUsers';

import type { UserServiceRow as UserServiceRowType } from '@/lib/api/internal';

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
    <div className="overflow-x-auto px-5 pb-4">{children}</div>
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

export default function UserDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referencedRequest = searchParams.get('ref') ?? undefined;
  const wantsNewDevice = searchParams.get('device') === 'new';
  const detail = useUserDetail(name);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(false);
  const [inviting, setInviting] = useState(false);

  const { data: session } = useSession();
  // only an administrator hands out portal access
  const isAdmin = hasAdminRole(session?.roles);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceService, setDeviceService] = useState<string | null>(null);

  useEffect(() => {
    if (wantsNewDevice) setDeviceOpen(true);
  }, [wantsNewDevice]);
  const [target, setTarget] = useState<{ row: UserServiceRowType; action: ServiceAction } | null>(
    null
  );

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

  const { user, devices, services, requests, device_types, interface_types } = detail.data;

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
              <h1 className="text-lg font-bold text-slate-900">{user.full_name}</h1>
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
                  onClick={() => setInviting(true)}
                  disabled={['Disabled', 'Archived'].includes(user.lifecycle_status)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  <Send size={13} />
                  {user.portal_user ? 'Resend invitation' : 'Invite to portal'}
                </button>
              )}
            </div>

            {user.remarks && (
              <p className="mt-2 max-w-2xl text-sm text-slate-600">{user.remarks}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
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
                <p className="text-xs font-medium text-slate-400">Portal access</p>
                <p className="mt-0.5 text-sm text-slate-700">
                  {user.portal_user ? user.portal_user : 'No'}
                </p>
              </div>
            </div>
            {user.remarks && (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {user.remarks}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={15} />
            Add service
          </button>
        </div>
      </div>

      <Panel title="Services">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <Th>Service</Th>
              <Th>Device</Th>
              <Th>Since</Th>
              <Th>Ended</Th>
              <Th>Billing</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {services.length === 0 && <Empty span={7}>No service assigned yet.</Empty>}
            {services.map((row) => {
              const open = !['Ended', 'Cancelled'].includes(row.operational_status);
              return (
                <tr key={row.name} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.service_name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.hostname || 'N/A'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(row.effective_start_date)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(row.effective_end_date)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.billing_status}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.operational_status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={
                          [
                            {
                              label: 'Suspend service',
                              icon: PauseCircle,
                              onClick: () => setTarget({ row, action: 'Suspend' }),
                              disabled: !open || row.operational_status === 'Suspended',
                            },
                            {
                              label: 'Resume service',
                              icon: PlayCircle,
                              onClick: () => setTarget({ row, action: 'Resume' }),
                              disabled: row.operational_status !== 'Suspended',
                            },
                            {
                              label: 'End service',
                              icon: CircleX,
                              onClick: () => setTarget({ row, action: 'End' }),
                              danger: true,
                              disabled: !open,
                            },
                          ] as RowAction[]
                        }
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
          <thead className="bg-slate-50">
            <tr>
              <Th>Hostname</Th>
              <Th>Type</Th>
              <Th>Network interfaces</Th>
              <Th>Assigned</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {devices.length === 0 && (
              <Empty span={6}>
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
                          disabled: device.status !== 'Active',
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
          <thead className="bg-slate-50">
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

      <PortalInviteModal
        open={inviting}
        user={user}
        onClose={() => setInviting(false)}
      />

      <EditClientUserModal
        open={editingUser}
        user={user}
        onClose={() => setEditingUser(false)}
      />

      <AddDeviceModal
        open={deviceOpen}
        clientUser={user.name}
        userName={user.full_name}
        deviceTypes={device_types}
        interfaceTypes={interface_types}
        requests={detail.data.customer_requests}
        defaultRequest={referencedRequest}
        onClose={() => setDeviceOpen(false)}
      />

      <AssignServiceModal
        open={assignOpen}
        detail={detail.data}
        defaultRequest={referencedRequest}
        onClose={() => setAssignOpen(false)}
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
