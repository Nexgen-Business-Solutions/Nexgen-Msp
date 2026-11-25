import React, { useEffect, useState } from 'react';
import BusinessText from '@/shared/components/BusinessText';
import { AlertCircle, ArrowLeft, Laptop, Package, PackagePlus, Search, SearchX, TriangleAlert } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import type { CatalogueSearchRow, ItemMspCompatibility } from '@/lib/api/internal';
import {
  useCatalogueItemSearch,
  useCreateMspService,
  useEnableItemForMsp,
  useItemCompatibility,
} from '../hooks/useCatalogue';

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (item: string) => void;
  /** the Item this was opened for, when it was opened from a service that already exists */
  item?: string | null;
};

type Step = 'choice' | 'search' | 'prepare' | 'create';

const SCOPES = [
  { value: 'User', label: 'User', description: 'Assigned directly to a managed person.' },
  {
    value: 'Device',
    label: 'Device',
    description:
      'Assigned directly to a managed Device and follows that Device between holders.',
  },
  {
    value: 'Both',
    label: 'Both',
    description: 'May be assigned either to a managed person or to a managed Device.',
  },
  {
    value: 'Customer',
    label: 'Customer',
    description:
      'Held by the company itself, with no person or Device behind it — a retainer, a block '
      + 'of storage, a line. Billed per customer.',
  },
];

const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

const Badge: React.FC<{ tone?: 'slate' | 'amber' | 'emerald'; children: React.ReactNode }> = ({
  tone = 'slate',
  children,
}) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
      tone === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : tone === 'emerald'
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
          : 'bg-slate-100 text-slate-600 ring-slate-200'
    }`}
  >
    {children}
  </span>
);

/** Adopting an existing ERPNext Item, or creating one already made for MSP. */
const ServiceModal: React.FC<Props> = ({ open, onClose, onSaved, item }) => {
  const [step, setStep] = useState<Step>('choice');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const [picked, setPicked] = useState<string | null>(null);

  const [scope, setScope] = useState('');
  const [invoiceLabel, setInvoiceLabel] = useState('');
  const [itemName, setItemName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState<string | null>(null);

  const results = useCatalogueItemSearch(debounced, open && step === 'search');
  const compatibility = useItemCompatibility(step === 'prepare' ? picked ?? undefined : undefined);
  const adopt = useEnableItemForMsp();
  const create = useCreateMspService();

  useEffect(() => {
    if (!open) return;
    // opened from a service that is already on file: that Item is the subject, and there is
    // nothing to search for
    setStep(item ? 'prepare' : 'choice');
    setSearch('');
    setPicked(item ?? null);
    setScope('');
    setInvoiceLabel('');
    setItemName('');
    setDescription('');
    setCode('');
    setConsent({});
    setFrom(null);
    adopt.reset();
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const card = compatibility.data as ItemMspCompatibility | undefined;
  const stockBlocked = card && !card.can_enable_in_place;

  useEffect(() => {
    if (!card || stockBlocked) return;
    setScope((current) => current || card.msp.scope || '');
    setInvoiceLabel((current) => current || card.msp.invoice_label || '');
    setItemName((current) => current || card.item.item_name || '');
    setDescription((current) => current || card.item.description || '');
  }, [card, stockBlocked]);

  const choose = (row: CatalogueSearchRow) => {
    setPicked(row.name);
    setStep('prepare');
  };

  const missing = (card?.repairs ?? []).filter((repair) => !consent[repair.field]);

  const submitExisting = async () => {
    if (!picked) return;

    await adopt.mutateAsync({
      item: picked,
      seen: card?.fingerprint ? JSON.stringify(card.fingerprint) : undefined,
      scope,
      invoice_label: invoiceLabel.trim() || undefined,
      item_name: itemName.trim() || undefined,
      description: description.trim() || undefined,
      enable_item: consent.enable_item ? 1 : 0,
      allow_sales: consent.allow_sales ? 1 : 0,
      add_month_uom: consent.add_month_uom ? 1 : 0,
      fix_month_factor: consent.fix_month_factor ? 1 : 0,
    });

    onSaved?.(picked);
    onClose();
  };

  const submitNew = async () => {
    const out = await create.mutateAsync({
      item_code: code.trim().toUpperCase(),
      item_name: itemName.trim(),
      scope,
      invoice_label: invoiceLabel.trim() || undefined,
      description: description.trim() || undefined,
    });

    onSaved?.(out.name);
    onClose();
  };

  const title =
    step === 'search'
      ? 'Use existing Item'
      : step === 'prepare'
        ? stockBlocked
          ? 'This Item is a stock item'
          : 'Prepare Item for MSP'
        : step === 'create'
          ? 'Create new MSP service'
          : 'Add service';

  const subtitle =
    step === 'prepare' && !stockBlocked
      ? 'Review the changes required before this ERPNext Item can be used by Nexgen MSP.'
      : step === 'create'
        ? 'Create a non-stock ERPNext Item and configure it for MSP.'
        : step === 'choice'
          ? 'Connect an existing ERPNext Item to Nexgen MSP or create a new service Item.'
          : undefined;

  const error = (adopt.error ?? create.error) as Error | undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Package}
      tone="blue"
      title={title}
      subtitle={subtitle}
      widthClass="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          {step !== 'choice' ? (
            <button
              type="button"
              onClick={() => setStep(step === 'prepare' ? 'search' : 'choice')}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>

            {step === 'prepare' && stockBlocked && (
              <button
                type="button"
                onClick={() => {
                  setFrom(card?.item.name ?? null);
                  setItemName(card?.item.item_name ?? '');
                  setDescription(card?.item.description ?? '');
                  setCode('');
                  setStep('create');
                }}
                className="rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                Create a service Item from this
              </button>
            )}

            {step === 'prepare' && !stockBlocked && (
              <button
                type="button"
                onClick={() => {
                  submitExisting().catch(() => undefined);
                }}
                disabled={!scope || missing.length > 0 || adopt.isLoading}
                className="rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Apply changes &amp; add to MSP
              </button>
            )}

            {step === 'create' && (
              <button
                type="button"
                onClick={() => {
                  submitNew().catch(() => undefined);
                }}
                disabled={!code.trim() || !itemName.trim() || !scope || create.isLoading}
                className="rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Create service
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {step === 'choice' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep('search')}
              className="rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200/70 transition hover:bg-blue-50/40 hover:ring-blue-300"
            >
              <span
                aria-hidden
                className="mb-3 grid size-9 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100"
              >
                <Search size={16} strokeWidth={1.75} />
              </span>
              <p className="text-sm font-semibold text-slate-900">Use existing Item</p>
              <p className="mt-1 text-xs text-slate-500">
                Find any ERPNext Item, including disabled or stock Items, and check whether it
                can be used by MSP.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setStep('create')}
              className="rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200/70 transition hover:bg-blue-50/40 hover:ring-blue-300"
            >
              <span
                aria-hidden
                className="mb-3 grid size-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
              >
                <PackagePlus size={16} strokeWidth={1.75} />
              </span>
              <p className="text-sm font-semibold text-slate-900">Create new Item</p>
              <p className="mt-1 text-xs text-slate-500">
                Create a new non-stock Item and its MSP service definition together.
              </p>
            </button>
          </div>
        )}

        {step === 'search' && (
          <div className="space-y-3">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by Item name or code…"
                aria-label="Search by Item name or code…"
              />
            </div>

            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-2xl bg-white ring-1 ring-slate-200/70">
              {(results.data?.rows ?? []).length === 0 && (
                <div className="flex items-center justify-center gap-3 px-3 py-6 text-xs text-slate-500">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200">
                    <SearchX className="size-4" strokeWidth={1.75} />
                  </span>
                  <p>No Item matches that.</p>
                </div>
              )}
              {(results.data?.rows ?? []).map((row) => (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => choose(row)}
                  className="flex w-full flex-col gap-1 px-3.5 py-3 text-left transition-colors hover:bg-slate-50/80"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      <BusinessText>{row.item_name}</BusinessText>
                    </span>
                    <span className="font-mono text-xs text-slate-500">{row.name}</span>
                    <span className="text-xs text-slate-400">{row.item_group}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {row.in_msp ? (
                      <Badge tone="emerald">Already in MSP</Badge>
                    ) : (
                      <Badge>Not in MSP</Badge>
                    )}
                    {Boolean(row.disabled) && <Badge tone="amber">Disabled</Badge>}
                    {row.is_stock_item ? <Badge tone="amber">Stock item</Badge> : <Badge>Non-stock</Badge>}
                    {row.month_ready ? <Badge tone="emerald">Month ready</Badge> : <Badge tone="amber">Month missing</Badge>}
                  </span>
                  <span className="text-xs text-slate-500">
                    Stock UOM: {row.stock_uom ?? 'N/A'} · Sales UOM: {row.sales_uom ?? 'N/A'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'prepare' && compatibility.isLoading && (
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="size-5 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500" />
            <p>Loading…</p>
          </div>
        )}

        {step === 'prepare' && card && stockBlocked && (
          <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
              <span className="grid size-7 place-items-center rounded-lg bg-white/70 text-amber-600 ring-1 ring-amber-200">
                <Laptop size={14} />
              </span>
              <BusinessText>{card.item.item_name}</BusinessText>
            </p>
            <p className="mt-2 text-sm text-amber-900">
              MSP services must use non-stock Items. Nexgen MSP will not change an existing stock
              Item because doing so can affect inventory history.
            </p>
          </div>
        )}

        {step === 'prepare' && card && !stockBlocked && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Item code</FieldLabel>
                <input className={`${inputClass} bg-slate-50`} readOnly value={card.item.name} />
              </div>
              <div>
                <FieldLabel>Name</FieldLabel>
                <input
                  className={inputClass}
                  value={itemName}
                  aria-label="Name"
                  onChange={(event) => setItemName(event.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <input
                  className={inputClass}
                  value={description}
                  aria-label="Description"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-xl bg-slate-50/70 p-3 text-xs text-slate-600 ring-1 ring-slate-200/60">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Infos</p>
              <p className="mt-1">Status: {card.item.disabled ? 'Disabled' : 'Enabled'}</p>
              <p>Stock item: {card.item.is_stock_item ? 'Yes' : 'No'}</p>
              <p>Sales item: {card.item.is_sales_item ? 'Yes' : 'No'}</p>
              <p>Stock UOM: {card.item.stock_uom ?? 'N/A'}</p>
              <p>Sales UOM: {card.item.sales_uom ?? 'N/A'}</p>

              {Boolean(card.item.disabled) && (
                <p className="mt-2 text-amber-800">
                  This Item is disabled globally in ERPNext. It must be enabled before it can be
                  available in MSP.
                </p>
              )}
              {!card.item.is_sales_item && (
                <p className="mt-2 text-amber-800">This Item is not marked as a sales Item.</p>
              )}
            </div>

            <div className="rounded-xl bg-slate-50/70 p-3 ring-1 ring-slate-200/60">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                MSP billing UOM
              </p>
              <p className="mt-1 text-sm text-slate-800">{card.billing.required_uom}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {card.billing.has_required_uom && card.billing.conversion_factor === 1
                  ? 'Ready'
                  : card.billing.has_required_uom
                    ? `Month currently uses conversion factor ${card.billing.conversion_factor}. MSP billing requires conversion factor 1.`
                    : 'Month is not configured for this Item.'}
              </p>
            </div>

            {card.repairs.map((repair) => (
              <label
                key={repair.field}
                className="flex cursor-pointer items-center gap-3 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-amber-300 accent-amber-600"
                  checked={Boolean(consent[repair.field])}
                  onChange={(event) =>
                    setConsent((current) => ({ ...current, [repair.field]: event.target.checked }))
                  }
                />
                <span className="text-sm font-semibold text-amber-900">{repair.label}</span>
              </label>
            ))}

            {card.warnings.map((warning) => (
              <p
                key={warning}
                className="inline-flex items-start gap-2 rounded-xl bg-white p-3 text-xs text-slate-600 ring-1 ring-slate-200/70"
              >
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-500" />
                {warning}
              </p>
            ))}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel required>Service scope</FieldLabel>
                <Select
                  className="w-full"
                  value={scope}
                  onChange={setScope}
                  placeholder="Select a scope"
                  options={SCOPES}
                />
              </div>
              <div>
                <FieldLabel>Invoice label</FieldLabel>
                <input
                  className={inputClass}
                  value={invoiceLabel}
                  aria-label="Invoice label"
                  onChange={(event) => setInvoiceLabel(event.target.value)}
                />
                <p className="mt-1 text-xs text-slate-400">
                  Leave empty to use the ERPNext Item name.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 'create' && (
          <div className="space-y-4">
            {from && <p className="text-xs text-slate-500">Based on ERPNext Item: {from}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel required>Service code</FieldLabel>
                <input
                  className={`${inputClass} uppercase`}
                  value={code}
                  aria-label="Service code"
                  placeholder="SVC-M365"
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <div>
                <FieldLabel required>Name</FieldLabel>
                <input
                  className={inputClass}
                  value={itemName}
                  aria-label="Name"
                  placeholder="Microsoft 365 Business"
                  onChange={(event) => setItemName(event.target.value)}
                />
              </div>
              <div>
                <FieldLabel required>Service scope</FieldLabel>
                <Select
                  className="w-full"
                  value={scope}
                  onChange={setScope}
                  placeholder="Select a scope"
                  options={SCOPES}
                />
              </div>
              <div>
                <FieldLabel>Invoice label</FieldLabel>
                <input
                  className={inputClass}
                  value={invoiceLabel}
                  aria-label="Invoice label"
                  onChange={(event) => setInvoiceLabel(event.target.value)}
                />
                <p className="mt-1 text-xs text-slate-400">
                  Leave empty to use the ERPNext Item name.
                </p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <input
                  className={inputClass}
                  value={description}
                  aria-label="Description"
                  placeholder="What the customer receives."
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm font-medium text-red-700">{error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ServiceModal;
