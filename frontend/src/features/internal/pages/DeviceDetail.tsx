import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  CircleX,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  PowerOff,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RemarkLog from '@/shared/components/RemarkLog';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import ConfirmModal from '@/shared/components/ConfirmModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import EditDeviceModal from '../components/EditDeviceModal';
import HandOverModal from '../components/HandOverModal';
import ServiceActionModal, { type ServiceAction } from '../components/ServiceActionModal';
import type { DeviceDetail as DeviceDetailData, DeviceRow, UserServiceRow } from '@/lib/api/internal';
import {
  deviceKeys,
  useChangeDeviceStatus,
  useDeleteDevice,
  useDeviceDetail,
} from '../hooks/useDevices';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

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

const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-xs font-medium text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm text-slate-700">{value}</p>
  </div>
);

/** The row shape the edit modal expects, rebuilt from what the detail already holds. */
const asDeviceRow = (data: DeviceDetailData): DeviceRow => ({
  name: data.device.name,
  hostname: data.device.hostname,
  device_type: data.device.device_type,
  status: data.device.status,
  assigned_date: data.device.assigned_date,
  serial_number: data.device.serial_number,
  customer: data.device.customer,
  assigned_client_user: data.device.assigned_client_user,
  user_name: data.device.user_name,
  user_department: null,
  user_status: null,
  active_services: data.services.filter(
    (row) => !['Ended', 'Cancelled'].includes(row.operational_status)
  ).length,
  inactive_services: data.services.filter((row) =>
    ['Ended', 'Cancelled'].includes(row.operational_status)
  ).length,
  protected: 0,
  interfaces: data.interfaces,
});

export default function DeviceDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referencedRequest = searchParams.get('ref') ?? undefined;

  const detail = useDeviceDetail(name);
  const changeStatus = useChangeDeviceStatus();
  const remove = useDeleteDevice();

  const [addingService, setAddingService] = useState(false);
  const [editing, setEditing] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [statusAction, setStatusAction] = useState<'Retire' | 'Reinstate' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState<{ row: UserServiceRow; action: ServiceAction } | null>(null);

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
          {(detail.error as Error)?.message || 'Device not found.'}
        </div>
      </div>
    );
  }

  const { device, interfaces, services, requests, customer_requests, holder_log } = detail.data;
  const retired = device.status !== 'Active';
  const holder = (holder_log ?? []).find((spell) => spell.is_current);
  const openServices = services.filter(
    (row) => !['Ended', 'Cancelled'].includes(row.operational_status)
  );

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/devices')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to devices
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">{device.hostname}</h1>
              <StatusBadge value={device.status} />
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <Pencil size={13} />
                Edit device
              </button>
              <button
                type="button"
                onClick={() => setHandingOver(true)}
                disabled={retired}
                title={
                  retired
                    ? 'A retired device is held by nobody.'
                    : 'Record that it changed hands, on the day it did'
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                <ArrowRightLeft size={13} />
                Hand over
              </button>
              <button
                type="button"
                onClick={() => setStatusAction(retired ? 'Reinstate' : 'Retire')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                {retired ? <RotateCcw size={13} /> : <PowerOff size={13} />}
                {retired ? 'Put back in service' : 'Retire device'}
              </button>
              <button
                type="button"
                onClick={() => setDeleting(true)}
                disabled={!device.can_delete}
                title={
                  device.can_delete
                    ? 'Erase this device'
                    : `Cannot be deleted: ${device.delete_blockers.join(', ')}`
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <Fact label="Customer" value={device.customer} />
              <Fact
                label={retired ? 'Last held by' : 'Held by'}
                value={
                  device.assigned_client_user ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/msp/users/${device.assigned_client_user}`)}
                        className="font-medium text-blue-600 transition-colors hover:text-blue-700"
                      >
                        {device.user_name || device.assigned_client_user}
                      </button>
                      {holder && holder.lifecycle_status && holder.lifecycle_status !== 'Active' && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {holder.lifecycle_status.toUpperCase()}
                          {holder.disabled_date ? ` · ${fmtDate(holder.disabled_date)}` : ''}
                        </span>
                      )}
                    </span>
                  ) : (
                    'Nobody'
                  )
                }
              />
              <Fact label="Type" value={device.device_type || 'N/A'} />
              <Fact label="In service since" value={fmtDate(device.assigned_date)} />
              <Fact label="Serial number" value={device.serial_number || 'N/A'} />
              <Fact
                label="Model"
                value={[device.manufacturer, device.model].filter(Boolean).join(' ') || 'N/A'}
              />
              <Fact label="Operating system" value={device.operating_system || 'N/A'} />
              <Fact
                label="Billed up to"
                value={device.covered_until ? fmtDate(device.covered_until) : 'Never billed'}
              />
              <Fact
                label="Last billed on"
                value={device.last_billed_on ? fmtDate(device.last_billed_on) : 'Never'}
              />
              {retired && <Fact label="Retired on" value={fmtDate(device.retired_date)} />}
            </div>


          </div>

          <button
            type="button"
            onClick={() => setAddingService(true)}
            disabled={retired}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            Add service
          </button>
        </div>
      </div>

      <Panel title="Remarks">
        <RemarkLog
          entries={device.remark_log}
          target={{ doctype: 'Managed Device', name: device.name }}
          invalidate={deviceKeys.detail(device.name)}
        />
      </Panel>

      <Panel title={`Services (${openServices.length} running)`}>
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              <Th>Service</Th>
              <Th>Since</Th>
              <Th>Ended</Th>
              <Th>Billing</Th>
              <Th>Billed up to</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {services.length === 0 && (
              <Empty span={7}>Nothing runs on this machine, so it is billed for nothing.</Empty>
            )}
            {services.map((row) => {
              const open = !['Ended', 'Cancelled'].includes(row.operational_status);

              return (
                <tr key={row.name} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.service_name}
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
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.last_billed_on ? fmtDate(row.last_billed_on) : 'Never'}
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Network">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                <Th>Interface</Th>
                <Th>MAC address</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {interfaces.length === 0 && <Empty span={2}>No MAC address recorded.</Empty>}
              {interfaces.map((row, index) => (
                <tr key={`${row.mac_address}-${index}`}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {INTERFACE_LABEL[row.interface_type] ?? row.interface_type}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-700">
                    {row.mac_address}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Who has held it"
          action={
            <button
              type="button"
              onClick={() => setHandingOver(true)}
              disabled={retired}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <ArrowRightLeft size={15} />
              Hand over
            </button>
          }
        >
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                <Th>Held by</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(holder_log ?? []).length === 0 && <Empty span={3}>Never assigned to anyone.</Empty>}
              {(holder_log ?? []).map((spell) => (
                <tr key={spell.idx} className={spell.is_current ? 'bg-emerald-50/40' : ''}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/users/${spell.client_user}`)}
                      className="font-semibold text-slate-900 transition-colors hover:text-blue-700"
                    >
                      {spell.full_name || spell.client_user}
                    </button>
                    {Boolean(spell.is_current) &&
                      (retired ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                          LAST HOLDER
                        </span>
                      ) : (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          NOW
                        </span>
                      ))}
                    {spell.lifecycle_status && spell.lifecycle_status !== 'Active' && (
                      <span
                        className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
                        title={
                          spell.disabled_date
                            ? `${spell.lifecycle_status} since ${fmtDate(spell.disabled_date)}`
                            : undefined
                        }
                      >
                        {spell.lifecycle_status.toUpperCase()}
                        {spell.disabled_date ? ` · ${fmtDate(spell.disabled_date)}` : ''}
                      </span>
                    )}
                    {spell.note && (
                      <span className="ml-2 text-xs text-slate-400">{spell.note}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(spell.from_date)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {spell.to_date ? fmtDate(spell.to_date) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Requests about this device">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                <Th>Type</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Raised</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.length === 0 && <Empty span={4}>Nothing has been asked for it.</Empty>}
              {requests.map((row) => (
                <tr
                  key={row.name}
                  onClick={() => navigate(`/msp/requests/${row.name}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.request_type}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.priority}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(row.creation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <DeviceServiceModal
        device={addingService ? device.name : null}
        onClose={() => setAddingService(false)}
      />

      <EditDeviceModal
        device={editing ? asDeviceRow(detail.data) : null}
        onClose={() => setEditing(false)}
      />

      <ServiceActionModal
        clientUser={device.assigned_client_user ?? ''}
        target={target}
        requests={customer_requests}
        defaultRequest={referencedRequest}
        onClose={() => setTarget(null)}
      />

      <HandOverModal
        open={handingOver}
        device={device.name}
        hostname={device.hostname}
        customer={device.customer}
        currentHolder={device.assigned_client_user}
        currentHolderName={device.user_name}
        heldSince={(holder_log ?? []).find((spell) => spell.is_current)?.from_date}
        onClose={() => setHandingOver(false)}
      />

      <ConfirmModal
        open={deleting}
        tone="danger"
        title={`Delete ${device.hostname}?`}
        description="It carries nothing — no service, no billed line, no past holder. This cannot be undone."
        confirmLabel="Delete"
        loading={remove.isLoading}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await remove.mutateAsync(device.name);
          navigate('/msp/devices');
        }}
      />

      <ConfirmModal
        open={Boolean(statusAction)}
        tone={statusAction === 'Retire' ? 'danger' : 'info'}
        title={statusAction === 'Retire' ? 'Retire this device?' : 'Put this device back in service?'}
        description={
          statusAction === 'Retire'
            ? `Every service still running on ${device.hostname} is ended with it, so it stops being billed.`
            : `${device.hostname} becomes available again. Services are not reopened on their own.`
        }
        confirmLabel={statusAction === 'Retire' ? 'Retire' : 'Reinstate'}
        loading={changeStatus.isLoading}
        onCancel={() => setStatusAction(null)}
        onConfirm={async () => {
          await changeStatus.mutateAsync({
            device: device.name,
            action: statusAction as 'Retire' | 'Reinstate',
          });
          setStatusAction(null);
        }}
      />
    </div>
  );
}
