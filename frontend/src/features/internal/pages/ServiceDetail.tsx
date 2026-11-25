import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CircleCheck,
  FileText,
  Inbox,
  Package,
  Receipt,
  Users,
  type LucideIcon,
} from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { FrappeError } from '@/lib/api/client';
import { useEnableItemForMsp, useServiceDetail } from '../hooks/useCatalogue';

const STATUS_TONE: Record<string, string> = {
  Ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Historical Only': 'bg-slate-50 text-slate-600 ring-slate-200',
  'Needs Configuration': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Stock Item': 'bg-amber-50 text-amber-700 ring-amber-200',
  'ERPNext Disabled': 'bg-red-50 text-red-700 ring-red-200',
};

/** What went wrong, told apart rather than all called Not Found. */
const failure = (error: unknown, item: string) => {
  if (error instanceof FrappeError) {
    if (error.status === 404 || error.code === 'NOT_FOUND') {
      return {
        title: 'This Item no longer exists in ERPNext.',
        detail: `Item: ${item}`,
        retry: false,
      };
    }

    if (error.status === 403 || error.code === 'PERMISSION_DENIED') {
      return {
        title: 'You do not have permission to view the MSP service catalogue.',
        detail: null,
        retry: false,
      };
    }

    return { title: 'The service could not be loaded.', detail: error.message, retry: true };
  }

  return {
    title: 'The service could not be loaded.',
    detail: error instanceof Error ? error.message : null,
    retry: true,
  };
};

const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

// DeployOps panel, as on the dashboard: title, optional count chip and one muted line; a
// table runs to the card's edges, a form keeps the card's padding
const Panel = ({
  title,
  count,
  subtitle,
  flush = false,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  flush?: boolean;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
    <div className="px-5 pb-3 pt-5 sm:px-6">
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
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
    </div>
    <div className={flush ? 'max-h-[26rem] overflow-auto pb-2' : 'px-5 pb-5 sm:px-6'}>{children}</div>
  </section>
);

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="whitespace-nowrap border-b border-slate-200 bg-white px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">
    {children}
  </th>
);

// cells line up with the panel's padding at both ends of a row
const td = 'px-4 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6';

/** An empty table, said calmly: an icon in a soft circle and the line that explains it. */
const Empty = ({
  span,
  icon: Icon = Inbox,
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

/** A count from the service's record, in the dashboard's stat tile shape sized for a card. */
const Stat = ({
  icon: Icon,
  label,
  value,
  tile,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
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

export default function ServiceDetail() {
  const [params] = useSearchParams();
  const name = params.get('item') ?? '';
  const navigate = useNavigate();
  const detail = useServiceDetail(name);
  const save = useEnableItemForMsp();

  const [itemName, setItemName] = useState('');
  const [invoiceLabel, setInvoiceLabel] = useState('');
  const [scope, setScope] = useState('');
  const [description, setDescription] = useState('');

  const service = detail.data?.service;

  useEffect(() => {
    if (!service) return;
    setItemName(service.item_name ?? '');
    setInvoiceLabel(service.invoice_label ?? '');
    setScope(service.scope ?? 'User');
    setDescription(service.description ?? '');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.name]);

  if (!name) {
    return (
      <div className="space-y-3 px-6 pb-6 pt-5">
        <div className="flex flex-col items-center rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="grid size-11 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
            <Package className="size-5" strokeWidth={1.75} />
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-900">No service was selected.</p>
          <button
            type="button"
            onClick={() => navigate('/msp/services')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
          >
            Back to services
          </button>
        </div>
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
      </div>
    );
  }

  if (detail.error || !detail.data || !service) {
    const shown = detail.error
      ? failure(detail.error, name)
      : !detail.data
        ? {
            title: 'The service could not be loaded because the server returned no data.',
            detail: `Item: ${name}`,
            retry: true,
          }
        : {
            title:
              'The service could not be loaded because the server returned an incomplete response.',
            detail: `Item: ${name}`,
            retry: true,
          };

    return (
      <div className="space-y-3 px-6 pb-6 pt-5">
        <div className="flex items-start gap-3.5 rounded-2xl bg-red-50 p-5 ring-1 ring-red-200 sm:p-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-red-600 ring-1 ring-red-200">
            <AlertCircle className="size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
          <p className="text-sm font-semibold text-red-800">{shown.title}</p>
          {shown.detail && <p className="mt-1 text-sm text-red-700">{shown.detail}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {shown.retry && (
              <button
                type="button"
                onClick={() => detail.refetch()}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/msp/services')}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-red-700 ring-1 ring-red-200 transition-colors hover:bg-red-50"
            >
              Back to services
            </button>
          </div>
          </div>
        </div>
      </div>
    );
  }

  const { customers, contracts, billed, scopes } = detail.data;
  const dirty =
    itemName !== (service.item_name ?? '') ||
    invoiceLabel !== (service.invoice_label ?? '') ||
    scope !== (service.scope ?? 'User') ||
    description !== (service.description ?? '');

  const money = (value?: number | null) =>
    value == null ? '—' : Math.round(value).toLocaleString();

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <button
        type="button"
        onClick={() => navigate('/msp/services')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to services
      </button>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className={`grid size-14 shrink-0 place-items-center rounded-2xl ring-1 ${
              service.ready
                ? 'bg-blue-50 text-blue-600 ring-blue-100'
                : 'bg-slate-100 text-slate-500 ring-slate-200'
            }`}
          >
            <Package className="size-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{service.item_name}</h1>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                  STATUS_TONE[service.compatibility_status] ?? 'bg-slate-50 text-slate-600 ring-slate-200'
                }`}
              >
                {service.compatibility_status}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-slate-500">{service.name}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <Stat
            icon={Users}
            label="Open assignments"
            value={String(customers.reduce((sum, row) => sum + row.open_assignments, 0))}
            tile="bg-blue-50 text-blue-600 ring-blue-100"
          />
          <Stat
            icon={Receipt}
            label="Runs billed"
            value={String(billed.runs ?? 0)}
            tile="bg-violet-50 text-violet-600 ring-violet-100"
          />
          <Stat
            icon={Banknote}
            label="Revenue to date"
            value={money(billed.amount)}
            tile="bg-emerald-50 text-emerald-600 ring-emerald-100"
          />
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Service scope', service.scope ?? 'Not set'],
            [
              'MSP availability',
              service.msp_enabled ? (service.ready ? 'Available' : 'Needs configuration') : 'Not available',
            ],
            [
              'ERPNext status',
              service.is_stock_item ? 'Stock item' : service.disabled ? 'Disabled' : 'Enabled',
            ],
            ['MSP service definition', service.definition ?? 'Not configured for MSP'],
            ['Stock UOM', service.stock_uom ?? 'N/A'],
            ['Sales UOM', service.sales_uom ?? 'N/A'],
            [
              'MSP billing UOM',
              `${service.billing_uom} · ${
                service.has_month_uom && service.month_conversion_factor === 1
                  ? 'Ready'
                  : 'Needs configuration'
              }`,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 rounded-xl bg-slate-50/70 px-3.5 py-3 ring-1 ring-slate-200/60"
            >
              <dt className="text-[13px] text-slate-500">{label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Panel
        title="How it reads on the invoice"
        subtitle="The catalogue name is for us. The invoice label is what the customer sees."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <FieldLabel required>Catalogue name</FieldLabel>
            <input
              type="text"
              value={itemName}
              onChange={(event) => setItemName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel>Invoice label</FieldLabel>
            <input
              type="text"
              value={invoiceLabel}
              onChange={(event) => setInvoiceLabel(event.target.value)}
              placeholder={service.item_name}
              className={inputClass}
            />
            <p className="mt-1.5 text-sm text-slate-500">
              Left empty, the catalogue name is printed.
            </p>
          </div>
          <div>
            <FieldLabel>Attached to</FieldLabel>
            <Select
              className="w-full"
              value={scope}
              onChange={setScope}
              options={scopes.map((value) => ({ value, label: value }))}
            />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {save.error instanceof Error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{save.error.message}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          {!dirty && save.isSuccess && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CircleCheck size={15} />
              Saved
            </span>
          )}
          <button
            type="button"
            disabled={!dirty || !itemName.trim() || save.isLoading}
            onClick={() =>
              save.mutate({
                item: service.name,
                item_name: itemName.trim(),
                invoice_label: invoiceLabel.trim(),
                scope,
                description: description.trim(),
              })
            }
            className="flex min-w-[7rem] items-center justify-center rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      </Panel>

      <Panel
        title="Who runs it"
        count={customers.length}
        subtitle="Open assignments and the rate in force today."
        flush
      >
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
            <tr>
              <Th>Customer</Th>
              <Th>Open</Th>
              <Th>Billable</Th>
              <Th>Rate in force</Th>
              <Th>Discount</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.length === 0 && (
              <Empty span={5} icon={Users}>
                Nobody runs this service yet.
              </Empty>
            )}
            {customers.map((row) => (
              <tr
                key={row.customer}
                onClick={() => navigate(`/msp/customers/${row.customer}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50/80"
              >
                <td className={`whitespace-nowrap ${td} text-sm font-semibold text-slate-900`}>
                  {row.customer}
                </td>
                <td className={`whitespace-nowrap ${td} text-sm text-slate-600 tabular-nums`}>
                  {row.open_assignments}
                </td>
                <td className={`whitespace-nowrap ${td} text-sm text-slate-600 tabular-nums`}>
                  {row.billable_assignments}
                </td>
                <td className={`whitespace-nowrap ${td} text-sm tabular-nums`}>
                  {row.current_rate == null ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">No rate</span>
                  ) : (
                    <span className="text-slate-700">{money(row.current_rate)}</span>
                  )}
                </td>
                <td className={`whitespace-nowrap ${td} text-sm text-slate-600 tabular-nums`}>
                  {row.discount_percent ? `${row.discount_percent}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Contracts covering it" count={contracts.length} flush>
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
            <tr>
              <Th>Contract</Th>
              <Th>Customer</Th>
              <Th>Frequency</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contracts.length === 0 && (
              <Empty span={4} icon={FileText}>
                No contract covers this service, so it can never be billed.
              </Empty>
            )}
            {contracts.map((row) => (
              <tr
                key={row.name}
                onClick={() => navigate(`/msp/customers/${row.customer}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50/80"
              >
                <td className={`whitespace-nowrap ${td} text-sm font-semibold text-slate-900`}>
                  {row.title || row.name}
                </td>
                <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                  {row.customer}
                </td>
                <td className={`whitespace-nowrap ${td} text-sm text-slate-600`}>
                  {row.billing_frequency}
                </td>
                <td className={`whitespace-nowrap ${td}`}>
                  <StatusBadge value={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
