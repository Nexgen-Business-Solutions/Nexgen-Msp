import { useState } from 'react';
import BusinessText from '@/shared/components/BusinessText';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Building2,
  CircleCheck,
  CircleSlash,
  Coins,
  ExternalLink,
  FileText,
  Gauge,
  Globe,
  Hash,
  Laptop,
  Layers,
  ListChecks,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Play,
  Plus,
  Pause,
  Trash2,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import ConfirmModal from '@/shared/components/ConfirmModal';
import Modal from '@/shared/components/Modal';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import { today } from '@/shared/lib/today';
import ContractModal from '../components/ContractModal';
import CustomerModal from '../components/CustomerModal';
import AuthorityPanel from '../components/AuthorityPanel';
import BillingContactPanel from '../components/BillingContactPanel';
import CustomerServiceModal from '../components/CustomerServiceModal';
import MspContractModal from '../components/MspContractModal';
import RateModal from '../components/RateModal';
import { customerDeskUrl } from '@/lib/api/internal';
import type {
  ContractRate,
  MspContractDetail,
  ServiceAvailabilityCurrent,
} from '@/lib/api/internal';
import { useSetPageHeading } from '@/shared/layout/pageHeading';
import {
  useContract,
  useContractRates,
  useDeleteRate,
  useSetEligibility,
} from '../hooks/useContracts';
import {
  useMspContract,
  useMspContracts,
  useSetMspContractStatus,
} from '../hooks/useMspContracts';
import {
  useChangeCustomerService,
  useCustomerDetails,
  useCustomerServices,
} from '../hooks/useCustomerDetails';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '—');

const AGREEMENT_COLUMNS = [
  'Contract',
  'Status',
  'Period',
  'Frequency',
  'Services',
  'Runs',
  '',
];

const HELD_COLUMNS = ['Service', 'Quantity', 'State', 'Billing', 'Since', ''];

/** What each act does to a service the company holds, said before it is done. */
const HELD_ACTS = {
  Suspend: {
    title: 'Suspend this company service?',
    description:
      'It stops being billed from the day you choose, and can be resumed later. The periods '
      + 'already billed are untouched.',
    confirmLabel: 'Suspend service',
    tone: 'warning' as const,
  },
  Resume: {
    title: 'Resume this company service?',
    description:
      'It is billed again from the day you choose. The days it stood suspended are not billed.',
    confirmLabel: 'Resume service',
    tone: 'warning' as const,
  },
  End: {
    title: 'End this company service?',
    description:
      'It stops being billed from the day you choose. The periods already billed are '
      + 'untouched, and nothing already invoiced changes.',
    confirmLabel: 'End service',
    tone: 'danger' as const,
  },
};

const PRICING_COLUMNS = [
  'Service',
  'Offered',
  'Rate',
  'Valid from',
  'Valid to',
  'State',
  '',
];

const RATE_STATE: Record<string, string> = {
  Active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Scheduled: 'bg-blue-50 text-blue-700 ring-blue-200',
  Expired: 'bg-slate-50 text-slate-500 ring-slate-200',
};

const FACT_ICON: Record<string, LucideIcon> = {
  'Tax ID': Hash,
  Phone,
  Email: Mail,
  Website: Globe,
};

// DeployOps buttons: the accent for the one thing a panel is for, white and ringed for the rest
const primary =
  'inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60';
const secondary =
  'inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900';

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

/**
 * DeployOps panel, as on the dashboard: a white card with its title, an optional count and
 * one muted line, the action on the right, and the table running edge to edge beneath.
 */
const Panel = ({
  title,
  count,
  description,
  action,
  extra,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: React.ReactNode;
  /** a control that belongs to the heading, under its description */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
      <div className="min-w-0">
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
        {extra}
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** The hairline column heads of the dashboard, kept in view while the table scrolls. */
const Head = ({ columns }: { columns: string[] }) => (
  <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white">
    <tr>
      {columns.map((column, index) => (
        <th
          key={column || index}
          className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6"
        >
          {column}
        </th>
      ))}
    </tr>
  </thead>
);

/** An empty table or list, said calmly: an icon in a soft circle and the line that explains it. */
const Quiet = ({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) => (
  <div className="flex items-center justify-center gap-3 px-5 py-10 text-sm text-slate-500">
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
    <span>{children}</span>
  </div>
);

/** A count about this customer, in the dashboard's stat tile shape sized for a card. */
const Stat = ({
  icon: Icon,
  label,
  value,
  tile,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tile: string;
}) => (
  <div className="flex items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
    <span className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${tile}`}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <p className="text-xl font-semibold leading-tight tabular-nums text-slate-900">{value}</p>
      <p className="truncate text-[13px] text-slate-500">{label}</p>
    </div>
  </div>
);

export default function CustomerContract() {
  const { customer = '' } = useParams();
  const navigate = useNavigate();
  const detail = useContract(customer);
  const rates = useContractRates(customer);
  const remove = useDeleteRate(customer);
  const eligibility = useSetEligibility(customer);

  const profileDetails = useCustomerDetails(customer);
  const [editingCustomer, setEditingCustomer] = useState(false);
  useSetPageHeading(profileDetails.data?.customer_name || customer);

  const address = profileDetails.data?.address ?? null;

  // an empty grid of "N/A" says nothing — only show what is actually recorded
  const customerFacts = [
    { label: 'Tax ID', value: profileDetails.data?.tax_id },
    { label: 'Phone', value: address?.phone },
    { label: 'Email', value: address?.email_id },
    { label: 'Website', value: profileDetails.data?.website },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  const hasCustomerDetails = Boolean(address) || customerFacts.length > 0;

  const agreements = useMspContracts({ customer });
  const liveAgreement =
    (agreements.data ?? []).find((row) => row.status === 'Active') ?? null;
  const [showEveryService, setShowEveryService] = useState(false);
  // the services of one contract, read in a window of their own rather than crammed in a cell
  const [servicesOf, setServicesOf] = useState<{
    title: string;
    services: { service_item: string; service_name: string }[];
  } | null>(null);
  const setContractStatus = useSetMspContractStatus();
  const [ending, setEnding] = useState<string | null>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState<string | null>(null);
  const editing = useMspContract(editingAgreement ?? undefined);

  // the services the company itself holds: a retainer, a block of storage, a line
  const held = useCustomerServices(customer);
  const actOnHeld = useChangeCustomerService(customer);
  const [addingHeld, setAddingHeld] = useState(false);
  const [changingHeld, setChangingHeld] = useState<ServiceAvailabilityCurrent | null>(null);
  // suspending, resuming and ending all take effect on a day somebody chooses, and the
  // same dialog asks for it. Cancelling is none of those: nothing was ever provided
  const [actingHeld, setActingHeld] = useState<{
    row: ServiceAvailabilityCurrent;
    action: 'Suspend' | 'Resume' | 'End';
  } | null>(null);
  const [heldOn, setHeldOn] = useState(today());
  const [cancellingHeld, setCancellingHeld] = useState<ServiceAvailabilityCurrent | null>(null);

  const openHeldAction = (
    row: ServiceAvailabilityCurrent,
    action: 'Suspend' | 'Resume' | 'End'
  ) => {
    setHeldOn(today());
    actOnHeld.reset();
    setActingHeld({ row, action });
  };

  const [contractOpen, setContractOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<ContractRate | null>(null);
  const [presetService, setPresetService] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<ContractRate | null>(null);

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
          {(detail.error as Error)?.message || 'Customer not found.'}
        </div>
      </div>
    );
  }

  const { profile, services, readiness, price_list: priceList } = detail.data;

  // the catalogue holds every service the company sells; this customer only deals with a
  // few of them, and the rest is noise until someone deliberately goes looking for it
  const liveServices = services.filter(
    (service) =>
      service.is_eligible ||
      service.covered_by_contract ||
      service.in_use ||
      service.open_assignments > 0 ||
      service.rate_versions > 0
  );
  const shownServices = showEveryService ? services : liveServices;
  const hiddenServices = services.length - liveServices.length;
  const rateRows = rates.data ?? [];

  const openRate = (service?: string, rate?: ContractRate) => {
    setPresetService(service);
    setEditingRate(rate ?? null);
    setRateOpen(true);
  };

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden
              className={`grid size-14 shrink-0 place-items-center rounded-2xl ring-1 ${
                profileDetails.data?.disabled
                  ? 'bg-slate-100 text-slate-500 ring-slate-200'
                  : 'bg-blue-50 text-blue-600 ring-blue-100'
              }`}
            >
              <Building2 className="size-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {profileDetails.data?.customer_name || customer}
                </h1>
                <StatusBadge
                  value={profileDetails.data?.disabled ? 'Disabled' : 'Active'}
                />
                {Boolean(profileDetails.data?.msp_free_of_charge) && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    FREE OF CHARGE
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Customer account, services, pricing and decision-makers.
              </p>

              {/* this page is the commercial side; the people and the machines live on
                  their own screens, and these are the way through to them */}
              <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-slate-600">
                <button
                  type="button"
                  onClick={() => navigate(`/msp/users?customer=${encodeURIComponent(customer)}`)}
                  className="inline-flex items-center gap-1.5 font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                >
                  <Users size={14} className="shrink-0" strokeWidth={1.75} />
                  {profileDetails.data?.counts.users ?? 0} users
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/msp/devices?customer=${encodeURIComponent(customer)}`)}
                  className="inline-flex items-center gap-1.5 font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                >
                  <Laptop size={14} className="shrink-0" strokeWidth={1.75} />
                  {profileDetails.data?.counts.devices ?? 0} devices
                </button>
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={14} className="shrink-0 text-slate-400" strokeWidth={1.75} />
                  {profileDetails.data?.counts.contracts ?? 0} contract
                  {(profileDetails.data?.counts.contracts ?? 0) === 1 ? '' : 's'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            <a
              href={customerDeskUrl(customer)}
              target="_blank"
              rel="noreferrer"
              className={secondary}
            >
              <ExternalLink size={14} />
              Open account
            </a>
            <button type="button" onClick={() => setEditingCustomer(true)} className={secondary}>
              <Pencil size={14} />
              Edit details
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60">
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${
                readiness.ready
                  ? 'bg-emerald-50 text-emerald-600 ring-emerald-100'
                  : 'bg-amber-50 text-amber-600 ring-amber-100'
              }`}
            >
              <Gauge className="size-[18px]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p
                className={`text-xl font-semibold leading-tight tabular-nums ${
                  readiness.ready ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {readiness.coverage}%
              </p>
              <p className="text-[13px] text-slate-500">Billing readiness</p>
              <p className="text-xs text-slate-400">
                {readiness.priced_assignments} of {readiness.billable_assignments} billable
                assignments carry a rate
              </p>
            </div>
          </div>
          <Stat
            icon={Layers}
            label="Services in use"
            value={liveServices.length}
            tile="bg-blue-50 text-blue-600 ring-blue-100"
          />
          <Stat
            icon={Coins}
            label="Rate versions"
            value={rateRows.length}
            tile="bg-violet-50 text-violet-600 ring-violet-100"
          />
          <Stat
            icon={Package}
            label="Held by the company"
            value={(held.data?.current ?? []).length}
            tile="bg-teal-50 text-teal-600 ring-teal-100"
          />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <h2 className="text-sm font-semibold text-slate-900">Company details</h2>
          {hasCustomerDetails ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {address && (
                <div className="flex min-w-0 items-start gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60 sm:row-span-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                    <MapPin className="size-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-slate-500">Billing address</p>
                    <div className="mt-0.5 text-sm leading-relaxed text-slate-800">
                      <p>{address.address_line1}</p>
                      {address.address_line2 && <p>{address.address_line2}</p>}
                      {[address.pincode, address.city, address.state].some(Boolean) && (
                        <p>
                          {[address.pincode, address.city, address.state]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}
                      <p>{address.country}</p>
                    </div>
                  </div>
                </div>
              )}

              {customerFacts.length > 0 && (
                <dl className="contents">
                  {customerFacts.map((fact) => {
                    const Icon = FACT_ICON[fact.label] ?? Hash;

                    return (
                      <div
                        key={fact.label}
                        className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                          <Icon className="size-[18px]" strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0">
                          <dt className="text-[13px] text-slate-500">{fact.label}</dt>
                          <dd className="truncate text-sm font-medium text-slate-900">{fact.value}</dd>
                        </div>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              No details recorded yet — invoices will show the name alone.
            </p>
          )}
        </div>

        {profileDetails.data?.msp_free_of_charge ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-emerald-50 p-3.5 ring-1 ring-emerald-200">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-emerald-600 ring-1 ring-emerald-200">
              <CircleCheck size={16} strokeWidth={1.75} />
            </span>
            <p className="self-center text-sm text-emerald-800">
              This customer is served free of charge — no contract, no rates, never billed.
            </p>
          </div>
        ) : readiness.ready ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-emerald-50 p-3.5 ring-1 ring-emerald-200">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-emerald-600 ring-1 ring-emerald-200">
              <CircleCheck size={16} strokeWidth={1.75} />
            </span>
            <p className="self-center text-sm text-emerald-800">
              This customer can be billed — every billable assignment resolves a rate.
            </p>
          </div>
        ) : (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-amber-600 ring-1 ring-amber-200">
              <TriangleAlert size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 text-sm text-amber-900">
              <p className="font-semibold">Not billable yet</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-800">
                {readiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <Panel
        title="Contracts"
        count={(agreements.data ?? []).length}
        description="One contract produces one invoice. A service belongs to a single live contract."
        action={
          <button
            type="button"
            onClick={() => {
              setEditingAgreement(null);
              setAgreementOpen(true);
            }}
            className={primary}
          >
            <Plus size={14} />
            New contract
          </button>
        }
      >
        <div className="max-h-[62vh] overflow-auto pb-2">
          <table className="w-full">
            <Head columns={AGREEMENT_COLUMNS} />
            <tbody className="divide-y divide-slate-100">
              {(agreements.data ?? []).map((row) => (
                <tr key={row.name} className="transition-colors hover:bg-slate-50/80">
                  <td className={`whitespace-nowrap ${td} text-sm font-semibold text-slate-900`}>
                    {row.title || row.name}
                  </td>
                  <td className={td}>
                    <StatusBadge value={row.status} />
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {fmtDate(row.start_date)} → {row.end_date ? fmtDate(row.end_date) : 'open'}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {row.billing_frequency}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                    {row.services.length === 0 ? (
                      <span className="text-slate-400">None</span>
                    ) : (
                      <>
                        <span className="tabular-nums">{row.services.length}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setServicesOf({ title: row.title || row.name, services: row.services })
                          }
                          className="ml-2 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          View details
                        </button>
                      </>
                    )}
                  </td>
                  <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                    {row.run_count ?? 0}
                  </td>
                  <td className={`whitespace-nowrap ${td}`}>
                    <div className="flex justify-end">
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'Edit contract',
                            icon: Pencil,
                            onClick: () => {
                              setEditingAgreement(row.name);
                              setAgreementOpen(true);
                            },
                          },
                          {
                            label: 'See billing runs',
                            icon: Coins,
                            onClick: () => navigate(`/msp/billing?customer=${row.customer}`),
                          },
                          ...(row.status === 'Ended'
                            ? []
                            : [
                                {
                                  label: 'End contract',
                                  icon: CircleSlash,
                                  danger: true,
                                  onClick: () => setEnding(row.name),
                                },
                              ]),
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}

              {(agreements.data ?? []).length === 0 && !agreements.isLoading && (
                <tr>
                  <td colSpan={AGREEMENT_COLUMNS.length}>
                    <Quiet icon={FileText}>
                      No contract yet. Nothing can be billed until one is in place.
                    </Quiet>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Pricing"
        count={shownServices.length}
        description="Each rate is a dated version. Adding one never rewrites the past."
        extra={
          hiddenServices > 0 && (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showEveryService}
                onChange={(event) => setShowEveryService(event.target.checked)}
                className="size-4 rounded border-slate-300 accent-blue-500"
              />
              <span className="text-xs text-slate-500">
                Show the {hiddenServices} service(s) this customer does not use
              </span>
            </label>
          )
        }
        action={
          <button
            type="button"
            onClick={() => openRate()}
            disabled={!priceList}
            className={primary}
          >
            <Plus size={14} />
            New rate
          </button>
        }
      >
        <div className="max-h-[62vh] overflow-auto pb-2">
          <table className="w-full">
            <Head columns={PRICING_COLUMNS} />
            <tbody className="divide-y divide-slate-100">
              {shownServices.length === 0 && (
                <tr>
                  <td colSpan={PRICING_COLUMNS.length}>
                    <Quiet icon={Coins}>No service is offered to or used by this customer yet.</Quiet>
                  </td>
                </tr>
              )}
              {shownServices.flatMap((service) => {
                const versions = rateRows.filter((row) => row.item_code === service.service_item);
                const blocking =
                  service.billable_assignments > 0 &&
                  !(service.is_eligible && versions.some((v) => v.state === 'Active'));

                const offered = (
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(service.is_eligible)}
                      disabled={
                        Boolean(service.covered_by_contract) || !profile || eligibility.isLoading
                      }
                      onChange={(event) =>
                        eligibility.mutate({
                          customer,
                          service_item: service.service_item,
                          is_eligible: event.target.checked ? 1 : 0,
                        })
                      }
                      className="size-4 rounded border-slate-300 accent-blue-500"
                    />
                    <span
                      className="text-xs text-slate-500"
                      title={
                        service.covered_by_contract
                          ? `Covered by ${service.covered_by_contract}. Change the contract to stop offering it.`
                          : undefined
                      }
                    >
                      {service.covered_by_contract
                        ? `Under ${service.covered_by_contract}`
                        : service.is_eligible
                          ? 'Offered'
                          : 'Not offered'}
                    </span>
                  </label>
                );

                if (versions.length === 0) {
                  return [
                    <tr key={service.service_item} className={blocking ? 'bg-amber-50/40' : ''}>
                      <td className={td}>
                        <p className="text-sm font-semibold text-slate-900">
                          <BusinessText>{service.service_name}</BusinessText>
                        </p>
                        {service.open_assignments > 0 && (
                          <p className="text-xs text-slate-400">
                            {service.open_assignments} open assignment(s)
                          </p>
                        )}
                      </td>
                      <td className={`whitespace-nowrap ${td}`}>{offered}</td>
                      <td className={`whitespace-nowrap ${td} text-sm text-slate-400`} colSpan={3}>
                        No rate recorded
                      </td>
                      <td className={`whitespace-nowrap ${td}`}>
                        {blocking && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium capitalize text-amber-700 ring-1 ring-amber-200">
                            <TriangleAlert size={11} />
                            blocking
                          </span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap ${td}`}>
                        <div className="flex justify-end">
                          <RowActionsMenu
                            actions={[
                              {
                                label: 'Add a rate',
                                icon: Coins,
                                onClick: () => openRate(service.service_item),
                                disabled: !priceList,
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>,
                  ];
                }

                return versions.map((version, index) => (
                  <tr
                    key={version.name}
                    className={`transition-colors hover:bg-slate-50/80 ${
                      blocking && index === 0 ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className={td}>
                      {index === 0 ? (
                        <>
                          <p className="text-sm font-semibold text-slate-900">
                            <BusinessText>{service.service_name}</BusinessText>
                          </p>
                          {service.open_assignments > 0 && (
                            <p className="text-xs text-slate-400">
                              {service.open_assignments} open assignment(s)
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-300">↳</span>
                      )}
                    </td>
                    <td className={`whitespace-nowrap ${td}`}>{index === 0 ? offered : null}</td>
                    <td className={`whitespace-nowrap ${td} text-sm font-semibold tabular-nums text-slate-900`}>
                      {version.price_list_rate.toLocaleString()} {version.currency ?? ''}
                    </td>
                    <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                      {fmtDate(version.valid_from)}
                    </td>
                    <td className={`whitespace-nowrap ${td} text-sm tabular-nums text-slate-600`}>
                      {version.valid_upto ? fmtDate(version.valid_upto) : 'open-ended'}
                    </td>
                    <td className={`whitespace-nowrap ${td}`}>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          RATE_STATE[version.state] ?? 'bg-slate-50 text-slate-600 ring-slate-200'
                        }`}
                      >
                        {version.state}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap ${td}`}>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={
                            [
                              {
                                label: 'Add a rate',
                                icon: Coins,
                                onClick: () => openRate(service.service_item),
                                disabled: !priceList,
                              },
                              {
                                label: 'Correct this rate',
                                icon: Pencil,
                                onClick: () => openRate(service.service_item, version),
                              },
                              {
                                label: 'Delete this version',
                                icon: Trash2,
                                onClick: () => setDeleting(version),
                                danger: true,
                              },
                            ] as RowAction[]
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>

        {eligibility.error instanceof Error && (
          <div className="mx-5 mb-5 rounded-2xl bg-red-50 p-3.5 text-sm font-medium text-red-700 ring-1 ring-red-200 sm:mx-6">
            {eligibility.error.message}
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(servicesOf)}
        onClose={() => setServicesOf(null)}
        icon={ListChecks}
        title={servicesOf?.title ?? ''}
        subtitle={`${servicesOf?.services.length ?? 0} service(s) covered by this contract`}
        widthClass="max-w-lg"
      >
        <ul className="divide-y divide-slate-100">
          {(servicesOf?.services ?? []).map((service) => (
            <li key={service.service_item} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm font-medium text-slate-900">
                <BusinessText>{service.service_name}</BusinessText>
              </span>
              <span className="text-xs text-slate-500">
                <BusinessText>{service.service_item}</BusinessText>
              </span>
            </li>
          ))}
        </ul>
      </Modal>

      <ContractModal
        open={contractOpen}
        customer={customer}
        profile={profile}
        onClose={() => setContractOpen(false)}
      />

      <Panel
        title="Company services"
        count={(held.data?.current ?? []).length}
        description="What the company itself holds, with nobody behind it. Billed to the company by its own quantity."
        action={
          <button
            type="button"
            onClick={() => setAddingHeld(true)}
            disabled={held.isLoading}
            className={primary}
          >
            <Plus size={14} />
            Add service
          </button>
        }
      >
        {held.error instanceof Error && (
          <p className="mx-5 mb-4 rounded-2xl bg-red-50 p-3.5 text-sm text-red-700 ring-1 ring-red-200 sm:mx-6">
            {held.error.message}
          </p>
        )}

        {(held.data?.current ?? []).length === 0 ? (
          <Quiet icon={Package}>
            {held.isLoading
              ? 'Loading…'
              : 'Nothing is held by the company itself. A service for a person or a machine lives on their own page.'}
          </Quiet>
        ) : (
          <div className="overflow-auto pb-2">
            <table className="w-full">
              <Head columns={HELD_COLUMNS} />
              <tbody className="divide-y divide-slate-100">
                {(held.data?.current ?? []).map((row) => (
                  <tr key={row.name} className="transition-colors hover:bg-slate-50/80">
                    <td className={td}>
                      <p className="text-sm font-semibold text-slate-900">{row.item_name}</p>
                      <p className="text-xs text-slate-400">{row.service_item}</p>
                    </td>
                    <td className={`whitespace-nowrap ${td}`}>
                      <p className="text-sm tabular-nums text-slate-700">{row.quantity}</p>
                      {row.uom && <p className="text-xs text-slate-400">Sold in {row.uom}</p>}
                    </td>
                    <td className={`whitespace-nowrap ${td}`}>
                      <StatusBadge value={row.operational_status} />
                    </td>
                    <td className={`whitespace-nowrap ${td} text-sm text-slate-500`}>
                      {row.billing_status}
                    </td>
                    <td className={`whitespace-nowrap ${td} text-sm text-slate-500`}>
                      {fmtDate(row.effective_start_date)}
                    </td>
                    <td className={`${td} text-right`}>
                      <RowActionsMenu
                        disabledReason={
                          // the reason explains why the acts on a running service are gone,
                          // so it is only given when those are the acts in question: a
                          // pending service can still be cancelled, and saying nothing is
                          // available would take that away too
                          row.dated_change &&
                          ['Active', 'Suspended'].includes(row.operational_status)
                            ? 'A change to this service is already set for a day to come.'
                            : undefined
                        }
                        actions={[
                          {
                            label: 'Change quantity or rate',
                            icon: Pencil,
                            onClick: () => setChangingHeld(row),
                            // a period already carrying a dated change takes no second
                            // one: the lifecycle refuses it, so offering it here would
                            // only produce an error somebody has to read
                            disabled: row.operational_status !== 'Active' || row.dated_change,
                          },
                          {
                            label: 'Suspend',
                            icon: Pause,
                            onClick: () => openHeldAction(row, 'Suspend'),
                            disabled: row.operational_status !== 'Active' || row.dated_change,
                          },
                          {
                            label: 'Resume',
                            icon: Play,
                            onClick: () => openHeldAction(row, 'Resume'),
                            disabled: row.operational_status !== 'Suspended' || row.dated_change,
                          },
                          {
                            label: 'End service',
                            icon: CircleSlash,
                            danger: true,
                            onClick: () => openHeldAction(row, 'End'),
                            // only a service being provided has provision to stop
                            disabled:
                              !['Active', 'Suspended'].includes(row.operational_status) ||
                              row.dated_change,
                          },
                          {
                            label: 'Cancel pending service',
                            icon: Trash2,
                            danger: true,
                            onClick: () => setCancellingHeld(row),
                            disabled: row.operational_status !== 'Pending Setup',
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {actOnHeld.error instanceof Error && (
              <p className="mx-5 mt-2 text-sm font-medium text-red-700 sm:mx-6">{actOnHeld.error.message}</p>
            )}
          </div>
        )}
      </Panel>

      {(addingHeld || changingHeld) && (
        <CustomerServiceModal
          customer={customer}
          label={profileDetails.data?.customer_name || customer}
          reading={held.data}
          changing={changingHeld}
          mayPrice={Boolean(profileDetails.data?.can.manage_pricing)}
          onClose={() => {
            setAddingHeld(false);
            setChangingHeld(null);
          }}
        />
      )}

      <ConfirmModal
        open={Boolean(actingHeld)}
        tone={actingHeld ? HELD_ACTS[actingHeld.action].tone : 'danger'}
        title={actingHeld ? HELD_ACTS[actingHeld.action].title : ''}
        description={actingHeld ? HELD_ACTS[actingHeld.action].description : undefined}
        confirmLabel={actingHeld ? HELD_ACTS[actingHeld.action].confirmLabel : undefined}
        loading={actOnHeld.isLoading}
        error={actOnHeld.error instanceof Error ? actOnHeld.error.message : null}
        onCancel={() => setActingHeld(null)}
        onConfirm={async () => {
          if (!actingHeld) return;
          try {
            await actOnHeld.mutateAsync({
              assignment: actingHeld.row.name,
              action: actingHeld.action,
              effective_date: heldOn || undefined,
            });
            setActingHeld(null);
          } catch {
            // the message shows in the dialog
          }
        }}
      >
        <label className="block text-xs font-medium text-slate-500">
          Effective date
          <input
            type="date"
            value={heldOn}
            onChange={(event) => setHeldOn(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border-0 bg-slate-100/80 px-3 text-sm text-slate-900 outline-none transition focus:bg-white focus:ring-1 focus:ring-blue-500"
          />
        </label>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(cancellingHeld)}
        tone="danger"
        title="Cancel this prepared service?"
        description={
          'It was never provided, so nothing was ever billed. The record is dropped, and the '
          + 'company can be sold the service again.'
        }
        confirmLabel="Cancel service"
        loading={actOnHeld.isLoading}
        error={actOnHeld.error instanceof Error ? actOnHeld.error.message : null}
        onCancel={() => setCancellingHeld(null)}
        onConfirm={async () => {
          if (!cancellingHeld) return;
          try {
            await actOnHeld.mutateAsync({ assignment: cancellingHeld.name, action: 'Cancel' });
            setCancellingHeld(null);
          } catch {
            // the message shows in the dialog
          }
        }}
      />

      <BillingContactPanel customer={customer} />

      {/* who decides is the administrator's business: a technician is refused the read on
          the server, so the screen does not offer them a panel that cannot answer */}
      {profileDetails.data?.can.manage_contracts && <AuthorityPanel customer={customer} />}

      <MspContractModal
        open={agreementOpen}
        customer={customer}
        contract={editingAgreement ? ((editing.data as MspContractDetail) ?? null) : null}
        onClose={() => {
          setAgreementOpen(false);
          setEditingAgreement(null);
        }}
      />

      <RateModal
        open={rateOpen}
        customer={customer}
        currency={profile?.currency ?? null}
        services={services}
        editing={editingRate}
        presetService={presetService}
        contractWindow={liveAgreement}
        onClose={() => setRateOpen(false)}
      />

      <CustomerModal
        open={editingCustomer}
        customer={customer}
        details={profileDetails.data ?? null}
        onClose={() => setEditingCustomer(false)}
      />

      <ConfirmModal
        open={Boolean(ending)}
        tone="danger"
        title="End this contract?"
        description={
          'Its services stop being covered: they can no longer be billed, and the customer '
          + 'can no longer request them. Invoices already issued are untouched, and the '
          + 'services become free to put on another contract.'
        }
        confirmLabel="End contract"
        loading={setContractStatus.isLoading}
        onCancel={() => setEnding(null)}
        onConfirm={async () => {
          await setContractStatus.mutateAsync({ name: ending as string, status: 'Ended' });
          setEnding(null);
        }}
      />

      <ConfirmModal
        open={Boolean(deleting)}
        tone="danger"
        title="Delete this rate version?"
        description={
          deleting?.state === 'Expired'
            ? 'It applied to a past period. Deleting it means those periods can no longer be recomputed.'
            : 'Any period it covers will lose its rate until another version applies.'
        }
        confirmLabel="Delete"
        loading={remove.isLoading}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.name);
            setDeleting(null);
          } catch {
            // the message shows below
          }
        }}
      />

      {remove.error instanceof Error && (
        <div className="rounded-2xl bg-red-50 p-3.5 text-sm font-medium text-red-700 ring-1 ring-red-200">
          {remove.error.message}
        </div>
      )}
    </div>
  );
}
