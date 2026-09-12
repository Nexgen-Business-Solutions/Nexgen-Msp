import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Laptop, Plus } from 'lucide-react';
import RemarkLog from '@/shared/components/RemarkLog';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useSession } from '@/shared/hooks/useSession';
import { isAdmin as hasAdminRole } from '@/shared/layout/navigation';
import AddDeviceModal from '../components/AddDeviceModal';
import AddUserServiceModal from '../components/AddUserServiceModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import EditClientUserModal from '../components/EditClientUserModal';
import HeldDeviceCard from '../components/HeldDeviceCard';
import ServiceActionModal, { type ServiceAction } from '../components/ServiceActionModal';
import UserAttentionPanel from '../components/UserAttentionPanel';
import UserHistoryPanel from '../components/UserHistoryPanel';
import UserIdentityCard from '../components/UserIdentityCard';
import UserOpenRequests from '../components/UserOpenRequests';
import UserServiceList from '../components/UserServiceList';
import {
  userKeys,
  useCustomerRequests,
  useDeleteClientUser,
  useUserDetail,
} from '../hooks/useUsers';
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

/**
 * One person's situation, in the order somebody acting on it needs it: who they are, what
 * needs looking at, what is being done for them, what is theirs, what they hold, then the past.
 *
 * Nothing is carried out from here. The standard way to change anything is to raise a
 * request, which the workbench then executes — one workflow, not four.
 */
export default function UserDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useUserDetail(name);
  const remove = useDeleteClientUser();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [addingDevice, setAddingDevice] = useState(false);
  const [deviceService, setDeviceService] = useState<string | null>(null);
  const [applying, setApplying] = useState<{
    service: UserServiceEntry;
    device: HeldDevice | null;
    action: ServiceAction;
  } | null>(null);

  // the request list a citation field offers, fetched by the forms that want it
  const customerRequests = useCustomerRequests(detail.data?.user.customer);
  const deviceOptions = useDeviceFilterOptions();

  const { data: session } = useSession();
  const isAdmin = hasAdminRole(session?.roles);

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

  const ask = (params: Record<string, string>) =>
    navigate(`/msp/requests/new?${new URLSearchParams(params).toString()}`);

  const openRequest = (request: string) => navigate(`/msp/requests/${request}`);

  // the request rules say Remove; the modal that carries it out here says End
  const DIRECT_ACTION: Record<string, ServiceAction> = {
    Suspend: 'Suspend',
    Resume: 'Resume',
    Remove: 'End',
  };

  const apply = (service: UserServiceEntry, action: string, device: HeldDevice | null) => {
    const direct = DIRECT_ACTION[action];

    if (direct) setApplying({ service, device, action: direct });
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
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
        onNewRequest={() => ask({ client_user: user.name })}
      />

      <UserAttentionPanel signals={data.attention} />

      <UserOpenRequests requests={data.open_requests} onOpen={openRequest} />

      <Panel
        title={`Personal services · ${data.summary.active_personal_services} open`}
        action={
          <button
            type="button"
            onClick={() => setAddingService(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus size={13} />
            Add service
          </button>
        }
      >
        {data.personal_services.target_reason && (
          <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {data.personal_services.target_reason}
          </p>
        )}
        <UserServiceList
          services={data.personal_services.current}
          available={data.personal_services.available}
          emptyMessage={`No personal service open for ${user.full_name}.`}
          onAsk={(service, action) =>
            ask({
              client_user: user.name,
              assignment: service.name,
              action,
            })
          }
          onAdd={() => setAddingService(true)}
          onApply={(service, action) => apply(service, action, null)}
          onOpenRequest={openRequest}
        />
      </Panel>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Current devices
          </h2>
          <button
            type="button"
            onClick={() => setAddingDevice(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus size={13} />
            Assign a device
          </button>
        </div>

        {data.devices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <p className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Laptop size={15} className="text-slate-400" />
              {user.full_name} currently holds no device.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setAddingDevice(true)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Assign a device
              </button>
              <button
                type="button"
                onClick={() => ask({ client_user: user.name, device: 'new' })}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Request a device
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {data.devices.map((slot) => (
              <HeldDeviceCard
                key={slot.device.name}
                slot={slot}
                onAsk={(service, action) =>
                  ask({
                    client_user: user.name,
                    device: slot.device.name,
                    assignment: service.name,
                    action,
                  })
                }
                onAdd={() => setDeviceService(slot.device.name)}
                onApply={(service, action) => apply(service, action, slot)}
                onAddService={() => setDeviceService(slot.device.name)}
                onOpenRequest={openRequest}
                onOpenDevice={(device) => navigate(`/msp/devices/${device}`)}
              />
            ))}
          </div>
        )}
      </section>

      <UserHistoryPanel name={user.name} recent={data.recent_activity} />

      <div className="grid gap-4 lg:grid-cols-2">
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

        <Panel title="Internal notes">
          <RemarkLog
            entries={data.notes.log}
            target={{ doctype: 'MSP Client User', name: user.name }}
            invalidate={userKeys.detail(user.name)}
          />
        </Panel>
      </div>

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
                },
                action: applying.action,
              }
            : null
        }
        requests={customerRequests.data ?? []}
        onClose={() => setApplying(null)}
      />

      <EditClientUserModal open={editing} user={user} onClose={() => setEditing(false)} />

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
    </div>
  );
}
