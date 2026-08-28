import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CircleCheck, FileText, Package } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useSaveService, useServiceDetail } from '../hooks/useCatalogue';

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const Panel = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
    <div className="px-5 py-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
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

export default function ServiceDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const detail = useServiceDetail(name);
  const save = useSaveService();

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

  if (detail.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  if (detail.error || !detail.data || !service) {
    return (
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          {(detail.error as Error)?.message || 'Service not found.'}
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
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/services')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to services
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <Package size={18} className="text-slate-400" />
          <h1 className="text-lg font-bold text-slate-900">{service.item_name}</h1>
          <StatusBadge value={service.disabled ? 'Retired' : 'Active'} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-slate-400">Attached to</p>
            <p className="mt-0.5 text-sm text-slate-700">{service.scope ?? 'User'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Billed in</p>
            <p className="mt-0.5 text-sm text-slate-700">{service.uom ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Runs billed</p>
            <p className="mt-0.5 text-sm text-slate-700">{billed.runs ?? 0}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Revenue to date</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">{money(billed.amount)}</p>
          </div>
        </div>
      </div>

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
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
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
                name: service.name,
                item_name: itemName.trim(),
                invoice_label: invoiceLabel.trim(),
                scope,
                description: description.trim(),
              })
            }
            className="flex min-w-[7rem] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      </Panel>

      <Panel title="Who runs it" subtitle="Open assignments and the rate in force today.">
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              <Th>Customer</Th>
              <Th>Open</Th>
              <Th>Billable</Th>
              <Th>Rate in force</Th>
              <Th>Discount</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.length === 0 && <Empty span={5}>Nobody runs this service yet.</Empty>}
            {customers.map((row) => (
              <tr
                key={row.customer}
                onClick={() => navigate(`/msp/customers/${row.customer}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                  {row.customer}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {row.open_assignments}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {row.billable_assignments}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums">
                  {row.current_rate == null ? (
                    <span className="font-medium text-amber-600">No rate</span>
                  ) : (
                    <span className="text-slate-700">{money(row.current_rate)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 tabular-nums">
                  {row.discount_percent ? `${row.discount_percent}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Contracts covering it">
        <table className="w-full">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
            <tr>
              <Th>Contract</Th>
              <Th>Customer</Th>
              <Th>Frequency</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contracts.length === 0 && (
              <Empty span={4}>
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={14} />
                  No contract covers this service, so it can never be billed.
                </span>
              </Empty>
            )}
            {contracts.map((row) => (
              <tr
                key={row.name}
                onClick={() => navigate(`/msp/customers/${row.customer}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                  {row.title || row.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {row.customer}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                  {row.billing_frequency}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
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
