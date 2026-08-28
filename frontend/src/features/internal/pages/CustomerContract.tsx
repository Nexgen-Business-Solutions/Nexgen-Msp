import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CircleCheck,
  CircleSlash,
  Coins,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import ConfirmModal from '@/shared/components/ConfirmModal';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import ContractModal from '../components/ContractModal';
import CustomerModal from '../components/CustomerModal';
import MspContractModal from '../components/MspContractModal';
import RateModal from '../components/RateModal';
import type { ContractRate, MspContractDetail } from '@/lib/api/internal';
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
import { useCustomerDetails } from '../hooks/useCustomerDetails';

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
  Active: 'bg-emerald-100 text-emerald-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  Expired: 'bg-slate-100 text-slate-500',
};

export default function CustomerContract() {
  const { customer = '' } = useParams();
  const navigate = useNavigate();
  const detail = useContract(customer);
  const rates = useContractRates(customer);
  const remove = useDeleteRate(customer);
  const eligibility = useSetEligibility(customer);

  const profileDetails = useCustomerDetails(customer);
  const [editingCustomer, setEditingCustomer] = useState(false);

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
  const setContractStatus = useSetMspContractStatus();
  const [ending, setEnding] = useState<string | null>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState<string | null>(null);
  const editing = useMspContract(editingAgreement ?? undefined);

  const [contractOpen, setContractOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<ContractRate | null>(null);
  const [presetService, setPresetService] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<ContractRate | null>(null);

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
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/customers')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to customers
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-slate-900">
                {profileDetails.data?.customer_name || customer}
              </h1>
              {Boolean(profileDetails.data?.msp_free_of_charge) && (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  FREE OF CHARGE
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditingCustomer(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <Pencil size={13} />
                Edit details
              </button>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              {profileDetails.data?.counts.users ?? 0} users ·{' '}
              {profileDetails.data?.counts.devices ?? 0} devices ·{' '}
              {profileDetails.data?.counts.contracts ?? 0} contract
              {(profileDetails.data?.counts.contracts ?? 0) === 1 ? '' : 's'}
            </p>

            {hasCustomerDetails ? (
              <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                {address && (
                  <div>
                    <p className="text-xs font-medium text-slate-400">Billing address</p>
                    <div className="mt-0.5 leading-relaxed text-slate-700">
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
                )}

                {customerFacts.length > 0 && (
                  <dl className="space-y-1.5">
                    {customerFacts.map((fact) => (
                      <div key={fact.label} className="flex gap-2">
                        <dt className="w-24 shrink-0 text-xs font-medium text-slate-400">
                          {fact.label}
                        </dt>
                        <dd className="truncate text-slate-700">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-400">
                No details recorded yet — invoices will show the name alone.
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-400">Billing readiness</p>
            <p
              className={`text-2xl font-bold tabular-nums ${
                readiness.ready ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {readiness.coverage}%
            </p>
            <p className="text-xs text-slate-400">
              {readiness.priced_assignments} of {readiness.billable_assignments} billable
              assignments carry a rate
            </p>
          </div>
        </div>

        {profileDetails.data?.msp_free_of_charge ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
            <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-800">
              This customer is served free of charge — no contract, no rates, never billed.
            </p>
          </div>
        ) : readiness.ready ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
            <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-800">
              This customer can be billed — every billable assignment resolves a rate.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold">Not billable yet</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {readiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Contracts</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              One contract produces one invoice. A service belongs to a single live contract.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingAgreement(null);
              setAgreementOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={15} />
            New contract
          </button>
        </div>

        <div className="max-h-[62vh] overflow-auto px-5 pb-4">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {AGREEMENT_COLUMNS.map((column, index) => (
                  <th
                    key={column || index}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === AGREEMENT_COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(agreements.data ?? []).map((row) => (
                <tr key={row.name} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {row.title || row.name}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {fmtDate(row.start_date)} → {row.end_date ? fmtDate(row.end_date) : 'open'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {row.billing_frequency}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.services.map((service) => (
                        <span
                          key={service.service_item}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                        >
                          {service.service_name}
                        </span>
                      ))}
                      {row.services.length === 0 && (
                        <span className="text-sm text-slate-400">None</span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                    {row.run_count ?? 0}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
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
                  <td
                    colSpan={AGREEMENT_COLUMNS.length}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    No contract yet. Nothing can be billed until one is in place.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Pricing</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              Each rate is a dated version. Adding one never rewrites the past.
            </p>
            {hiddenServices > 0 && (
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={showEveryService}
                  onChange={(event) => setShowEveryService(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-xs text-slate-500">
                  Show the {hiddenServices} service(s) this customer does not use
                </span>
              </label>
            )}
          </div>
          <button
            type="button"
            onClick={() => openRate()}
            disabled={!priceList}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            New rate
          </button>
        </div>

        <div className="max-h-[62vh] overflow-auto px-5 pb-4">
          <table className="w-full">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
              <tr>
                {PRICING_COLUMNS.map((column, index) => (
                  <th
                    key={column || index}
                    className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      index === 0 ? 'rounded-l-lg' : ''
                    } ${index === PRICING_COLUMNS.length - 1 ? 'rounded-r-lg' : ''}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
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
                      className="h-4 w-4 rounded border-slate-300"
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
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {service.service_name}
                        </p>
                        {service.open_assignments > 0 && (
                          <p className="text-xs text-slate-400">
                            {service.open_assignments} open assignment(s)
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{offered}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400" colSpan={3}>
                        No rate recorded
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {blocking && (
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                            blocking
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
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
                    className={`transition-colors hover:bg-slate-50 ${
                      blocking && index === 0 ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      {index === 0 ? (
                        <>
                          <p className="text-sm font-semibold text-slate-900">
                            {service.service_name}
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
                    <td className="whitespace-nowrap px-4 py-3">{index === 0 ? offered : null}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900 tabular-nums">
                      {version.price_list_rate.toLocaleString()} {version.currency ?? ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {fmtDate(version.valid_from)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {version.valid_upto ? fmtDate(version.valid_upto) : 'open-ended'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                          RATE_STATE[version.state]
                        }`}
                      >
                        {version.state}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
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
          <div className="mx-5 mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
            {eligibility.error.message}
          </div>
        )}
      </div>

      <ContractModal
        open={contractOpen}
        customer={customer}
        profile={profile}
        onClose={() => setContractOpen(false)}
      />

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
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
          {remove.error.message}
        </div>
      )}
    </div>
  );
}
