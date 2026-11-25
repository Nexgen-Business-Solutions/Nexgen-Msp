import { useState } from 'react';
import ServiceState from '../components/ServiceState';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CalendarCheck, History, Laptop, Layers, Plus, Receipt, type LucideIcon } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import Select from '@/shared/components/Select';
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
import type { HeldDevice, UserPortfolioEntry, UserServiceEntry } from '@/lib/api/internal';
import {
  buildDeviceRowActions,
  buildServiceAssignmentRowActions,
  type EntityRowAction,
} from '../actions';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'Never');

// a service that stopped is part of this person's file: the filter narrows, it never hides
const SERVICE_VIEWS = [
  ['all', 'All services'],
  ['current', 'Current'],
  ['suspended', 'Suspended'],
  ['ended', 'Ended'],
] as const;

// DeployOps panel, as on the dashboard: a white card with its title, an optional count and
// one muted line, the actions on the right, and the content running edge to edge beneath
const Panel = ({
  title,
  count,
  description,
  action,
  flush = false,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: React.ReactNode;
  /** a table runs to the card's edges; anything else keeps the card's padding */
  flush?: boolean;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
      <div className="min-w-0">
        {/* the count is part of the heading's name ("Devices · 2"), drawn as a chip */}
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          {title}
          {count !== undefined && (
            <>
              <span className="sr-only"> · </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                {count}
              </span>
            </>
          )}
        </h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
    <div className={flush ? 'pb-2' : 'px-5 pb-5 sm:px-6'}>{children}</div>
  </section>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">
    {children}
  </th>
);

/** An empty table, said calmly: an icon in a soft circle and the line that explains it. */
const Empty = ({
  span,
  icon: Icon = Layers,
  children,
}: {
  span: number;
  icon?: LucideIcon;
  children: React.ReactNode;
}) => (
  <tr>
    <td colSpan={span} className="px-4 py-10">
      <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span>{children}</span>
      </div>
    </td>
  </tr>
);

/** A dated fact from the billing side, in the shape of the dashboard's stat tiles. */
const DateTile = ({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) => (
  <div className="flex items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  </div>
);

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

// DeployOps secondary button, for the actions in a panel header
const secondary =
  'inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900';

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
  const [serviceView, setServiceView] = useState<(typeof SERVICE_VIEWS)[number][0]>('all');

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
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="px-6 pb-6 pt-5">
        <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-100">
          {(detail.error as Error)?.message || 'User not found.'}
        </div>
      </div>
    );
  }

  const data = detail.data;
  const { user } = data;

  const openRequest = (request: string) => navigate(`/msp/requests/${request}`);

  const portfolio = data.services ?? [];
  const countOf = (view: (typeof SERVICE_VIEWS)[number][0]) =>
    view === 'all'
      ? portfolio.length
      : portfolio.filter((row) =>
          view === 'current'
            ? ['Pending Setup', 'Active', 'Suspended'].includes(row.operational_status)
            : view === 'suspended'
              ? row.operational_status === 'Suspended'
              : row.operational_status === 'Ended'
        ).length;
  const services = portfolio.filter((row) =>
    serviceView === 'current'
      ? ['Pending Setup', 'Active', 'Suspended'].includes(row.operational_status)
      : serviceView === 'suspended'
        ? row.operational_status === 'Suspended'
        : serviceView === 'ended'
          ? row.operational_status === 'Ended'
          : true
  );
  const deviceOf = (row: UserPortfolioEntry) =>
    row.managed_device
      ? data.devices.find((slot) => slot.device.name === row.managed_device) ?? null
      : null;

  const serviceActions = (
    service: UserPortfolioEntry,
    device: HeldDevice | null
  ): EntityRowAction[] => {
    const act = (action: ServiceAction) => () => setApplying({ service, device, action });

    return buildServiceAssignmentRowActions({
      status: service.operational_status,
      canWrite: canAct,
      // a machine they gave back is acted on from its next holder's page, not from here
      currentHolding: Boolean(service.current_holding),
      onSuspend: act('Suspend'),
      onResume: act('Resume'),
      onChange: act('Change'),
      onEnd: act('End'),
    });
  };

  const deviceActions = (slot: HeldDevice): EntityRowAction[] =>
    buildDeviceRowActions({
      canWrite: canAct,
      onAddService: () => setDeviceService(slot.device.name),
      onTransfer: () => setMoving({ device: slot, kind: 'transfer' }),
      onReturnToStock: () => setMoving({ device: slot, kind: 'repossess' }),
      onOpen: () => navigate(`/msp/devices/${slot.device.name}`),
    });

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
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
          portal && !session?.scoped_msp && mayAsk ? (
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/new?client_user=${encodeURIComponent(user.name)}`)}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
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
        title="Services"
        count={portfolio.length}
        description="Everything billed against this person or the machines they hold, in any state."
        flush
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-44"
              value={serviceView}
              onChange={(value) => setServiceView(value as (typeof SERVICE_VIEWS)[number][0])}
              options={SERVICE_VIEWS.map(([value, label]) => ({
                value,
                label,
                description: `${countOf(value)} service assignment(s)`,
              }))}
            />
            {canAct && (
              <button
                type="button"
                onClick={() => setAddingService(true)}
                className={secondary}
              >
                <Plus size={14} />
                Add service
              </button>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white">
              <tr>
                <Th>Service</Th>
                <Th>Target</Th>
                <Th>Started</Th>
                <Th>Ended</Th>
                {seesBilling && <Th>Billed up to</Th>}
                {seesBilling && <Th>Billing</Th>}
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.length === 0 && (
                <Empty span={seesBilling ? 8 : 6} icon={Layers}>
                  {serviceView === 'all'
                    ? `No service assignment is recorded for ${user.full_name}.`
                    : `No ${serviceView} service assignment is recorded for ${user.full_name}.`}
                </Empty>
              )}
              {services.map((service) => (
                <tr key={service.name} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td} text-sm font-semibold text-slate-900`}>
                    {service.service_name}
                    {canAct && service.legacy_service && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/msp/services/detail?item=${encodeURIComponent(service.service_item)}`
                          )
                        }
                        className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"
                        title="Legacy MSP service"
                      >
                        Legacy MSP service · Configure for MSP
                      </button>
                    )}
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
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {service.assignment_scope === 'Device' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Laptop size={14} className="text-slate-400" strokeWidth={1.75} />
                        {service.target}
                      </span>
                    ) : (
                      'Person'
                    )}
                    {service.assignment_scope === 'Device' && (
                      <p className="text-xs text-slate-400">
                        held {fmtDate(service.association_from)}
                        {service.association_until
                          ? ` to ${fmtDate(service.association_until)}`
                          : ' — still holding'}
                      </p>
                    )}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(service.effective_start_date)}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {service.operational_status === 'Ended'
                      ? fmtDate(service.effective_end_date)
                      : '—'}
                  </td>
                  {seesBilling && (
                    <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                      {/* a service only carries a date of its own once a posted run has
                          covered it. Until then the person's own coverage is what is known,
                          and it is said to be that rather than passed off as an invoice */}
                      {service.last_billed_on ? (
                        fmtDate(service.last_billed_on)
                      ) : data.billing.covered_until ? (
                        <>
                          {fmtDate(data.billing.covered_until)}
                          <div className="text-xs text-slate-400">User coverage</div>
                        </>
                      ) : (
                        'Never'
                      )}
                    </td>
                  )}
                  {seesBilling && (
                    <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                      {service.billing_status || 'N/A'}
                    </td>
                  )}
                  <td className={`whitespace-nowrap ${td}`}>
                    <ServiceState
                      status={service.operational_status}
                      suspendedFrom={service.suspended_from}
                    />
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <div className="flex justify-end">
                      {canAct && service.operational_status !== 'Ended' && (
                        <RowActionsMenu actions={serviceActions(service, deviceOf(service))} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Devices"
        count={data.devices.length}
        description="The machines in their hands today."
        flush
        action={
          canAct ? (
          <button
            type="button"
            onClick={() => setAddingDevice(true)}
            className={secondary}
          >
            <Plus size={14} />
            Assign a device
          </button>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white">
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
                <Empty span={7} icon={Laptop}>
                  {user.full_name} currently holds no device.
                </Empty>
              )}
              {data.devices.map((slot) => (
                <tr key={slot.device.name} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td}`}>
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/devices/${slot.device.name}`)}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
                    >
                      <span className="grid size-8 place-items-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                        <Laptop size={15} strokeWidth={1.75} />
                      </span>
                      {slot.device.hostname}
                    </button>
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {slot.device.device_type || 'N/A'}
                  </td>
                  <td className={td}>
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
                  <td className={`whitespace-nowrap ${td} text-sm`}>
                    {slot.device.serial_number ? (
                      <span className="font-mono text-xs text-slate-800">{slot.device.serial_number}</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        Missing
                      </span>
                    )}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(slot.holder_since)}
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <StatusBadge value={slot.device.status} />
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <div className="flex justify-end">
                      <RowActionsMenu actions={deviceActions(slot)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Device history"
        count={data.device_history.length}
        description="Every machine they have held, and when."
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white">
              <tr>
                <Th>Device</Th>
                <Th>Type</Th>
                <Th>Serial</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.device_history.length === 0 && (
                <Empty span={6} icon={History}>No machine has ever been in their hands.</Empty>
              )}

              {data.device_history.map((spell) => (
                <tr
                  key={spell.period}
                  className={`transition-colors hover:bg-slate-50/80 ${spell.is_current ? '' : 'text-slate-500'}`}
                >
                  <td className={td}>
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/devices/${spell.device}`)}
                      className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
                    >
                      {spell.hostname || spell.device}
                    </button>
                  </td>
                  <td className={`${td} text-sm text-slate-600`}>
                    {spell.device_type || 'N/A'}
                  </td>
                  <td className={`${td} text-sm text-slate-600`}>
                    {spell.serial_number ? (
                      <span className="font-mono text-xs">{spell.serial_number}</span>
                    ) : (
                      'No serial'
                    )}
                  </td>
                  <td className={`${td} text-sm tabular-nums text-slate-600`}>{fmtDate(spell.from_date)}</td>
                  <td className={`${td} text-sm tabular-nums text-slate-600`}>
                    {/* still theirs: the spell is open, which is not the same as having no end */}
                    {spell.is_current ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                        Still held
                      </span>
                    ) : (
                      fmtDate(spell.to_date)
                    )}
                  </td>
                  <td className={td}>
                    <StatusBadge value={spell.device_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {seesBilling && (
        <Panel title="Billing & coverage" description="How far this person's services have been invoiced.">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DateTile icon={CalendarCheck} label="Billed up to" value={fmtDate(data.billing.covered_until)} />
            <DateTile icon={Receipt} label="Last billed on" value={fmtDate(data.billing.last_billed_on)} />
          </dl>
        </Panel>
        )}

        {canAct && (
        <Panel title="Internal notes" description="Seen by Nexgen staff only.">
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
