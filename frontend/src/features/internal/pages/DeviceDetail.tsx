import { useState } from 'react';
import ServiceState from '../components/ServiceState';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  History,
  Inbox,
  Layers,
  Network,
  Pencil,
  Plus,
  PowerOff,
  Receipt,
  RotateCcw,
  Trash2,
  Undo2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import Select from '@/shared/components/Select';
import { useSession } from '@/shared/hooks/useSession';
import RemarkLog from '@/shared/components/RemarkLog';
import RowActionsMenu from '@/shared/components/RowActionsMenu';
import ConfirmModal from '@/shared/components/ConfirmModal';
import DeviceServiceModal from '../components/DeviceServiceModal';
import EditDeviceModal from '../components/EditDeviceModal';
import AssignDeviceModal from '../components/AssignDeviceModal';
import TransferDeviceModal from '../components/TransferDeviceModal';
import RepossessDeviceModal from '../components/RepossessDeviceModal';
import RetireDeviceModal from '../components/RetireDeviceModal';
import ReinstateDeviceModal from '../components/ReinstateDeviceModal';
import ServiceActionModal, { type ServiceAction } from '../components/ServiceActionModal';
import RequestDeviceOperationModal from '@/features/portal/components/RequestDeviceOperationModal';
import type { DeviceDetail as DeviceDetailData, DeviceRow, UserServiceRow } from '@/lib/api/internal';
import { deviceKeys, useDeleteDevice, useDeviceDetail } from '../hooks/useDevices';
import { usePortalDeviceFile } from '@/features/portal/hooks/usePortal';
import { isAvailable, isDeployed, isOutOfService, canRetire } from '../utils/deviceStatus';
import { buildServiceAssignmentRowActions } from '../actions';
import { deviceIcon } from '../utils/deviceIcon';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

const INTERFACE_LABEL: Record<string, string> = {
  'Wi-Fi': 'MAC WIFI',
  LAN: 'MAC LAN',
  Extra: 'EXTRA MAC',
  Other: 'OTHER MAC',
};

type LifecycleModal = 'assign' | 'transfer' | 'repossess' | 'retire' | 'reinstate' | null;

// a machine's service history stays on its page: the filter narrows it, it never hides it
const SERVICE_VIEWS = [
  ['all', 'All services'],
  ['current', 'Current'],
  ['suspended', 'Suspended'],
  ['ended', 'Ended'],
] as const;

/** The acts a customer may ask for on a machine, which they never carry out themselves. */
type CustomerOperation = 'device.assign' | 'device.transfer' | 'device.repossess';

const CUSTOMER_ICON: Record<CustomerOperation, typeof UserPlus> = {
  'device.assign': UserPlus,
  'device.transfer': ArrowRightLeft,
  'device.repossess': Undo2,
};

// DeployOps panel, as on the dashboard and the user page: a white card, its title with an
// optional count beside it, one muted line, the actions on the right, the content beneath
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
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
              {count}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
    <div className={flush ? 'max-h-[26rem] overflow-auto pb-2' : 'px-5 pb-5 sm:px-6'}>{children}</div>
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

/** One line of the machine's specification: a quiet label over its value. */
const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
    <p className="text-[12px] text-slate-500">{label}</p>
    <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{value}</p>
  </div>
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

/** A small rounded label beside a name: who holds it now, who left. */
const Pill = ({ tone, children, title }: { tone: 'emerald' | 'slate' | 'amber'; children: React.ReactNode; title?: string }) => {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    slate: 'bg-slate-100 text-slate-500 ring-slate-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  };

  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

// DeployOps secondary button: white, hairline ring, fully rounded
const secondary =
  'inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900';

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
  has_services: 0,
  manufacturer: data.device.manufacturer,
  model: data.device.model,
  operating_system: data.device.operating_system,
  interfaces: data.interfaces,
});

/**
 * One machine's file. The customer reads the same page we do — what it is, who holds it, what
 * runs on it, what has been asked about it — while acting on it stays on our side.
 */
export default function DeviceDetail({ portal = false }: { portal?: boolean } = {}) {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referencedRequest = searchParams.get('ref') ?? undefined;

  const ours = useDeviceDetail(portal ? undefined : name);
  const theirs = usePortalDeviceFile(portal ? name : undefined);
  const detail = portal ? theirs : ours;
  const canAct = !portal;
  const { data: session } = useSession();
  // a contact who is kept away from invoices is kept away from billing dates too
  const seesBilling = canAct || session?.can_see_invoices !== false;
  const remove = useDeleteDevice();

  const [addingService, setAddingService] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lifecycleModal, setLifecycleModal] = useState<LifecycleModal>(null);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState<{ row: UserServiceRow; action: ServiceAction } | null>(null);
  const [asking, setAsking] = useState<{ code: CustomerOperation; label: string } | null>(null);
  const [serviceView, setServiceView] = useState<(typeof SERVICE_VIEWS)[number][0]>('all');

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
          {(detail.error as Error)?.message || 'Device not found.'}
        </div>
      </div>
    );
  }

  const {
    device,
    interfaces,
    services,
    requests,
    customer_requests,
    holder_log,
    pending_operation: pending,
    customer_operations: askable,
  } = detail.data;
  const currentSpell = (holder_log ?? []).find((spell) => spell.is_current);
  const lastSpell = (holder_log ?? []).length > 0 ? holder_log[holder_log.length - 1] : null;
  const countOf = (view: (typeof SERVICE_VIEWS)[number][0]) =>
    view === 'all'
      ? services.length
      : services.filter((row) =>
          view === 'current'
            ? ['Pending Setup', 'Active', 'Suspended'].includes(row.operational_status)
            : view === 'suspended'
              ? row.operational_status === 'Suspended'
              : row.operational_status === 'Ended'
        ).length;
  const shownServices = services.filter((row) =>
    serviceView === 'current'
      ? ['Pending Setup', 'Active', 'Suspended'].includes(row.operational_status)
      : serviceView === 'suspended'
        ? row.operational_status === 'Suspended'
        : serviceView === 'ended'
          ? row.operational_status === 'Ended'
          : true
  );
  const openServices = services.filter(
    (row) => !['Ended', 'Cancelled'].includes(row.operational_status)
  );
  const serviceActions = (row: UserServiceRow) => {
    const act = (action: ServiceAction) => () =>
      setTarget({
        row: {
          ...row,
          device_serial_number: device.serial_number,
          device_user_name: device.user_name,
        },
        action,
      });

    return buildServiceAssignmentRowActions({
      status: row.operational_status,
      canWrite: canAct,
      onSuspend: act('Suspend'),
      onResume: act('Resume'),
      onChange: act('Change'),
      onEnd: act('End'),
    });
  };

  const DeviceIcon = deviceIcon(device.device_type);
  const holders = [...(holder_log ?? [])].reverse();

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <button
        type="button"
        onClick={() => navigate('/msp/devices')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to devices
      </button>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden
              className={`grid size-14 shrink-0 place-items-center rounded-2xl ring-1 ${
                isOutOfService(device.status)
                  ? 'bg-slate-100 text-slate-500 ring-slate-200'
                  : 'bg-violet-50 text-violet-600 ring-violet-100'
              }`}
            >
              <DeviceIcon className="size-7" strokeWidth={1.5} />
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{device.hostname}</h1>
                <StatusBadge value={device.status} />
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={14} className="text-slate-400" strokeWidth={1.75} />
                  {device.customer}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <DeviceIcon size={14} className="text-slate-400" strokeWidth={1.75} />
                  {device.device_type || 'N/A'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            {canAct && (
              <button type="button" onClick={() => setEditing(true)} className={secondary}>
                <Pencil size={14} />
                Edit device
              </button>
            )}

            {/* a customer asks; nothing on the machine moves until Nexgen carries it out */}
            {portal && !session?.scoped_msp &&
              (askable ?? [])
                .filter((operation): operation is { code: CustomerOperation; label: string } =>
                  operation.code in CUSTOMER_ICON
                )
                .map((operation) => {
                  const Icon = CUSTOMER_ICON[operation.code];

                  return (
                    <button
                      key={operation.code}
                      type="button"
                      onClick={() => setAsking({ code: operation.code, label: operation.label })}
                      className={secondary}
                    >
                      <Icon size={14} />
                      {operation.label}
                    </button>
                  );
                })}

            {canAct && isAvailable(device.status) && (
              <button type="button" onClick={() => setLifecycleModal('assign')} className={secondary}>
                <UserPlus size={14} />
                Assign to user
              </button>
            )}

            {canAct && isDeployed(device.status) && (
              <>
                <button type="button" onClick={() => setLifecycleModal('transfer')} className={secondary}>
                  <ArrowRightLeft size={14} />
                  Transfer
                </button>
                <button type="button" onClick={() => setLifecycleModal('repossess')} className={secondary}>
                  <Undo2 size={14} />
                  Return to stock
                </button>
              </>
            )}

            {canAct && isOutOfService(device.status) && (
              <button type="button" onClick={() => setLifecycleModal('reinstate')} className={secondary}>
                <RotateCcw size={14} />
                Reinstate
              </button>
            )}

            {canAct && canRetire(device.status) && (
              <button type="button" onClick={() => setLifecycleModal('retire')} className={secondary}>
                <PowerOff size={14} />
                Retire
              </button>
            )}

            {canAct && (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                disabled={!device.can_delete}
                title={
                  device.can_delete
                    ? 'Erase this device'
                    : `Cannot be deleted: ${(device.delete_blockers ?? []).join(', ')}`
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:ring-slate-200 disabled:hover:bg-white"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 lg:grid-cols-[minmax(0,18rem)_1fr]">
          {/* who has it is the first thing anybody asks about a machine */}
          <div className="rounded-xl p-4 ring-1 ring-slate-200/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Current holder</p>
            {isDeployed(device.status) ? (
              <div className="mt-3 flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-100"
                >
                  {initials(device.user_name || device.assigned_client_user || '')}
                </span>
                <div className="min-w-0">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/users/${device.assigned_client_user}`)}
                      className="text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700"
                    >
                      {device.user_name || device.assigned_client_user}
                    </button>
                    {currentSpell?.lifecycle_status && currentSpell.lifecycle_status !== 'Active' && (
                      <Pill tone="amber">
                        {currentSpell.lifecycle_status.toUpperCase()}
                        {currentSpell.disabled_date ? ` · ${fmtDate(currentSpell.disabled_date)}` : ''}
                      </Pill>
                    )}
                  </span>
                  <p className="text-xs text-slate-500">
                    {device.user_department ? `${device.user_department} · ` : ''}since{' '}
                    {fmtDate(currentSpell?.from_date)}
                  </p>
                </div>
              </div>
            ) : isAvailable(device.status) ? (
              <p className="mt-3 text-sm font-medium text-slate-700">Available in stock</p>
            ) : (
              <div className="mt-3">
                <p className="text-sm font-medium text-slate-700">Nobody</p>
                {lastSpell ? (
                  <p className="text-xs text-slate-500">
                    Last holder: {lastSpell.full_name || lastSpell.client_user} · until{' '}
                    {fmtDate(lastSpell.to_date)}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">Nobody has ever held it.</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Serial number" value={device.serial_number || 'N/A'} />
            <Fact label="Manufacturer" value={device.manufacturer || 'N/A'} />
            <Fact label="Model" value={device.model || 'N/A'} />
            <Fact label="Operating system" value={device.operating_system || 'N/A'} />
            <Fact label="In service since" value={fmtDate(device.assigned_date)} />
            {isOutOfService(device.status) && (
              <Fact label="Out of service" value={fmtDate(device.retired_date)} />
            )}
          </div>
        </div>
      </section>

      <Panel
        title="Services"
        count={services.length}
        description="What runs on this machine, in any state."
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
                disabled={!isDeployed(device.status)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={15} />
                Add service
              </button>
            )}
          </div>
        }
      >
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
            <tr>
              <Th>Service</Th>
              <Th>Started</Th>
              <Th>Ended</Th>
              {seesBilling && <Th>Billing</Th>}
              {seesBilling && <Th>Billed up to</Th>}
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shownServices.length === 0 && (
              <Empty span={seesBilling ? 7 : 5} icon={Layers}>
                {serviceView === 'current'
                  ? 'No current service assignment is recorded for this Device.'
                  : 'No service assignment is recorded for this Device.'}
              </Empty>
            )}
            {shownServices.map((row) => {
              return (
                <tr key={row.name} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td} text-sm font-semibold text-slate-900`}>
                    {row.service_name}
                    {canAct && row.legacy_service && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/msp/services/detail?item=${encodeURIComponent(row.service_item)}`)
                        }
                        className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"
                        title="Legacy MSP service"
                      >
                        Legacy MSP service · Configure for MSP
                      </button>
                    )}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(row.effective_start_date)}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(row.effective_end_date)}
                  </td>
                  {seesBilling && (
                    <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                      {row.billing_status}
                    </td>
                  )}
                  {seesBilling && (
                    <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                      {/* a service only carries a date of its own once a posted run has
                          covered it. Until then the machine's own coverage is what is known,
                          and it is said to be that rather than passed off as an invoice */}
                      {row.last_billed_on ? (
                        fmtDate(row.last_billed_on)
                      ) : device.covered_until ? (
                        <>
                          {fmtDate(device.covered_until)}
                          <div className="text-xs text-slate-400">Device coverage</div>
                        </>
                      ) : (
                        'Never'
                      )}
                    </td>
                  )}
                  <td className={`whitespace-nowrap ${td}`}>
                    <ServiceState
                      status={row.operational_status}
                      suspendedFrom={row.suspended_from}
                    />
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <div className="flex justify-end">
                      {canAct && (
                      <RowActionsMenu actions={serviceActions(row)} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Who has held it" count={holders.length} description="The latest holder first." flush>
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
              <tr>
                <Th>Held by</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {holders.length === 0 && <Empty span={3} icon={History}>Never assigned to anyone.</Empty>}
              {holders.map((spell) => (
                <tr
                  key={spell.idx}
                  className={`transition-colors hover:bg-slate-50/80 ${spell.is_current ? 'bg-emerald-50/30' : ''}`}
                >
                  <td className={`${td} text-sm`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden
                        className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600"
                      >
                        {initials(spell.full_name || spell.client_user)}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/msp/users/${spell.client_user}`)}
                        className="font-semibold text-slate-900 transition-colors hover:text-blue-700"
                      >
                        {spell.full_name || spell.client_user}
                      </button>
                      {Boolean(spell.is_current) &&
                        (!isDeployed(device.status) ? (
                          <Pill tone="slate">LAST HOLDER</Pill>
                        ) : (
                          <Pill tone="emerald">NOW</Pill>
                        ))}
                      {spell.lifecycle_status && spell.lifecycle_status !== 'Active' && (
                        <Pill
                          tone="amber"
                          title={
                            spell.disabled_date
                              ? `${spell.lifecycle_status} since ${fmtDate(spell.disabled_date)}`
                              : undefined
                          }
                        >
                          {spell.lifecycle_status.toUpperCase()}
                          {spell.disabled_date ? ` · ${fmtDate(spell.disabled_date)}` : ''}
                        </Pill>
                      )}
                      {spell.note && <span className="text-xs text-slate-400">{spell.note}</span>}
                    </div>
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(spell.from_date)}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {spell.to_date ? fmtDate(spell.to_date) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Network" count={interfaces.length} description="Interfaces recorded on the machine." flush>
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
              <tr>
                <Th>Interface</Th>
                <Th>MAC address</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {interfaces.length === 0 && <Empty span={2} icon={Network}>No MAC address recorded.</Empty>}
              {interfaces.map((row, index) => (
                <tr key={`${row.mac_address}-${index}`} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td}`}>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-600">
                      {INTERFACE_LABEL[row.interface_type] ?? row.interface_type}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap ${td} font-mono text-sm text-slate-800`}>
                    {row.mac_address}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {pending && (
          <section className="rounded-2xl bg-blue-50/60 p-5 ring-1 ring-blue-100 sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-blue-100 text-blue-700 ring-1 ring-blue-200">
                <Inbox className="size-4" strokeWidth={1.75} />
              </span>
              <h2 className="text-base font-semibold text-slate-900">Pending request</h2>
            </div>
            <p className="mt-3 text-sm text-slate-700">
              {pending.operation_code === 'device.transfer' &&
                `Holder change requested: ${
                  pending.current_holder_name || 'Unassigned'
                } → ${pending.requested_holder_name || 'Unassigned'}`}
              {pending.operation_code === 'device.assign' &&
                `Assignment requested: Unassigned → ${
                  pending.requested_holder_name || 'Unassigned'
                }`}
              {pending.operation_code === 'device.repossess' &&
                `Return to stock requested for ${pending.current_holder_name || 'Unassigned'}`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Request {pending.request} · {pending.status}
            </p>
            <button
              type="button"
              onClick={() => navigate(`/msp/requests/${pending.request}`)}
              className={`mt-4 ${secondary}`}
            >
              View request
              <ArrowUpRight size={14} />
            </button>
          </section>
        )}

        <Panel title="Requests about this device" count={requests.length} flush>
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
              <tr>
                <Th>Type</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Raised</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.length === 0 && <Empty span={4} icon={Inbox}>Nothing has been asked for it.</Empty>}
              {requests.map((row) => (
                <tr
                  key={row.name}
                  onClick={() => navigate(`/msp/requests/${row.name}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50/80"
                >
                  <td className={`whitespace-nowrap ${td} text-sm font-semibold text-slate-900`}>
                    {row.request_type}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {row.priority}
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <StatusBadge value={row.status} />
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(row.creation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {seesBilling && (
          <Panel title="Billing & coverage" description="How far this machine's services have been invoiced.">
            <dl className="grid gap-3 sm:grid-cols-2">
              <DateTile
                icon={CalendarCheck}
                label="Billed up to"
                value={device.covered_until ? fmtDate(device.covered_until) : 'Never billed'}
              />
              <DateTile
                icon={Receipt}
                label="Last billed on"
                value={device.last_billed_on ? fmtDate(device.last_billed_on) : 'Never on its own'}
              />
            </dl>
          </Panel>
        )}

        {canAct && (
          <Panel title="Internal notes" description="Seen by Nexgen staff only.">
            <RemarkLog
              entries={device.remark_log ?? []}
              target={{ doctype: 'MSP Managed Device', name: device.name }}
              invalidate={deviceKeys.detail(device.name)}
            />
          </Panel>
        )}
      </div>

      {asking && (
        <RequestDeviceOperationModal
          code={asking.code}
          label={asking.label}
          device={{
            name: device.name,
            hostname: device.hostname,
            serial_number: device.serial_number,
          }}
          currentHolder={device.assigned_client_user}
          currentHolderName={device.user_name}
          onClose={() => setAsking(null)}
          onContinue={(seed) => {
            setAsking(null);
            navigate('/msp/requests/new', { state: { seed } });
          }}
        />
      )}

      {canAct && (
      <>
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
        requests={customer_requests ?? []}
        defaultRequest={referencedRequest}
        onClose={() => setTarget(null)}
      />

      <AssignDeviceModal
        open={lifecycleModal === 'assign'}
        device={device.name}
        hostname={device.hostname}
        serialNumber={device.serial_number}
        status={device.status}
        customer={device.customer}
        onClose={() => setLifecycleModal(null)}
      />

      <TransferDeviceModal
        open={lifecycleModal === 'transfer'}
        device={device.name}
        hostname={device.hostname}
        serialNumber={device.serial_number}
        customer={device.customer}
        currentHolder={device.assigned_client_user}
        currentHolderName={device.user_name}
        heldSince={currentSpell?.from_date}
        onClose={() => setLifecycleModal(null)}
      />

      <RepossessDeviceModal
        open={lifecycleModal === 'repossess'}
        device={device.name}
        hostname={device.hostname}
        serialNumber={device.serial_number}
        currentHolder={device.assigned_client_user}
        currentHolderName={device.user_name}
        onClose={() => setLifecycleModal(null)}
      />

      <RetireDeviceModal
        open={lifecycleModal === 'retire'}
        device={device.name}
        hostname={device.hostname}
        serialNumber={device.serial_number}
        currentHolder={device.assigned_client_user}
        currentHolderName={device.user_name}
        openServiceCount={openServices.length}
        onClose={() => setLifecycleModal(null)}
      />

      <ReinstateDeviceModal
        open={lifecycleModal === 'reinstate'}
        device={device.name}
        hostname={device.hostname}
        serialNumber={device.serial_number}
        customer={device.customer}
        onClose={() => setLifecycleModal(null)}
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
      </>
      )}
    </div>
  );
}
