import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { BillingCandidate } from '@/lib/api/internal';
import {
  useCreateOperation,
  useOperationAccounting,
  useOperationContext,
  useOperationServices,
} from '../hooks/useBilling';
import { useMspContracts } from '../hooks/useMspContracts';
import Select from '@/shared/components/Select';
import {
  Banner,
  Card,
  CardHead,
  ContextBar,
  Divider,
  InfoPanel,
  PanelTitle,
  Pill,
  Stepper,
  Summary,
  btn,
  btnPrimary,
} from '../components/billing/ui';
import { day, money } from '../components/billing/format';

const STEPS = ['Context', 'Services', 'Accounting', 'Confirm'];

const TITLES = [
  { title: 'Contract & period', hint: 'Review the suggested scope.' },
  { title: 'Review services', hint: 'Only the selected eligible lines will be included.' },
  {
    title: 'Accounting & notifications',
    hint: 'Keep the accounting and notification details for this document.',
  },
  { title: 'Confirm', hint: 'Verify the operation before preparing it.' },
];

const KINDS = [
  { value: 'period', label: 'Regular billing' },
  { value: 'additions', label: 'Additions' },
  { value: 'credit_note', label: 'Credit note' },
] as const;

const field =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500';

const Label: React.FC<{ htmlFor: string; children: React.ReactNode; required?: boolean }> = ({
  htmlFor,
  children,
  required,
}) => (
  <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-bold text-slate-500">
    {children}
    {required && <span className="ml-0.5 text-rose-500">*</span>}
  </label>
);

/**
 * The one path that prepares all three operations.
 *
 * Regular billing, additions and credits are four steps each — what is being billed, which
 * services, how it posts, and a last look — and each still ends in its own run and its own
 * document. Nothing is sent to ERPNext without the operator asking for it on the last step,
 * and submitting the document stays a separate decision on the run's own page.
 */
export default function NewBillingRun() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [kind, setKind] = useState<'period' | 'additions' | 'credit_note'>(
    (params.get('kind') as 'period' | 'additions' | 'credit_note') || 'period'
  );
  const [contract, setContract] = useState(params.get('contract') ?? '');
  const [start, setStart] = useState(params.get('start') ?? '');
  const [end, setEnd] = useState(params.get('end') ?? '');
  const against = params.get('against') ?? undefined;

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dimensions, setDimensions] = useState<Record<string, string>>({});
  const [exchange, setExchange] = useState('');
  const [discount, setDiscount] = useState('0');
  const [draftInvoice, setDraftInvoice] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const contracts = useMspContracts({ status: 'Active' });
  const query = contract ? { kind, contract, period_start: start, period_end: end, against } : null;
  const context = useOperationContext(query);
  const services = useOperationServices(step >= 1 && query ? query : null);
  const accounting = useOperationAccounting(contract, step >= 2);
  const create = useCreateOperation();

  const terms = context.data;

  // the engine's own window, taken as soon as it is known and nobody has typed another
  useEffect(() => {
    if (!terms) return;
    if (!start) setStart(String(terms.period_start).slice(0, 10));
    if (!end) setEnd(String(terms.period_end).slice(0, 10));
  }, [terms, start, end]);

  // every eligible line starts selected, which is what the proposal is
  useEffect(() => {
    if (!services.data) return;

    setSelected(
      Object.fromEntries(services.data.lines.map((line) => [line.id, true] as const))
    );
  }, [services.data]);

  useEffect(() => {
    if (!accounting.data) return;

    setDimensions((current) => {
      const next = { ...current };

      for (const dimension of accounting.data.dimensions) {
        if (!next[dimension.fieldname] && dimension.default) next[dimension.fieldname] = dimension.default;
      }

      return next;
    });
  }, [accounting.data]);

  const lines = useMemo(() => services.data?.lines ?? [], [services.data]);
  const blocked = services.data?.blocked ?? [];
  const chosen = lines.filter((line) => selected[line.id]);
  const total = chosen.reduce((sum, line) => sum + line.amount, 0);
  const currency = terms?.currency ?? services.data?.currency ?? '';

  const grouped = useMemo(() => {
    const groups = new Map<string, BillingCandidate[]>();

    for (const line of lines) {
      groups.set(line.person, [...(groups.get(line.person) ?? []), line]);
    }

    return [...groups.entries()];
  }, [lines]);

  const missingDimension = (accounting.data?.dimensions ?? []).find(
    (dimension) => dimension.mandatory && !dimensions[dimension.fieldname]
  );

  const forward = async () => {
    setRefused(null);

    if (step === 0) {
      if (!contract) return setRefused('Choose the contract this operation is for.');
      if (!start || !end) return setRefused('Give the period this operation covers.');
    }

    if (step === 1) {
      if (!chosen.length) return setRefused('Select at least one service.');
    }

    if (step === 2 && draftInvoice && missingDimension) {
      return setRefused(`${missingDimension.label} is required before a document can be drafted.`);
    }

    if (step === 3) {
      if (!accepted) return setRefused('Confirm your review before preparing the operation.');

      try {
        const made = await create.mutateAsync({
          kind,
          contract,
          period_start: start,
          period_end: end,
          include: chosen.map((line) => line.id),
          dimensions: draftInvoice ? dimensions : undefined,
          exchange_rate: exchange ? Number(exchange) : undefined,
          discount_percent: kind === 'credit_note' ? 0 : Number(discount || 0),
          against,
          draft_invoice: draftInvoice ? 1 : 0,
        });

        navigate(`/msp/billing/${made.run}`);
      } catch (error) {
        setRefused((error as Error).message);
      }

      return;
    }

    setStep((current) => current + 1);
    window.scrollTo(0, 0);
  };

  const back = () => {
    setRefused(null);
    if (step === 0) return navigate('/msp/billing');
    setStep((current) => current - 1);
  };

  const label = terms?.label ?? KINDS.find((entry) => entry.value === kind)?.label ?? 'Billing';
  const primary =
    step < 3
      ? 'Continue →'
      : kind === 'credit_note'
        ? 'Prepare credit note'
        : draftInvoice
          ? 'Prepare invoice draft'
          : 'Create billing run';

  return (
    <div className="space-y-4 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/billing')}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={14} />
        Back to billing
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">{label}</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {terms ? `${terms.customer} · ${terms.contract}` : 'Choose what to bill.'}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/msp/billing')} className={btn}>
            Cancel
          </button>
        </div>

        {terms && (
          <ContextBar
            facts={[
              {
                label: 'Billing',
                value: [terms.billing_frequency, terms.billing_timing].filter(Boolean).join(' / '),
              },
              { label: 'Period', value: `${day(start)} – ${day(end)}` },
              { label: 'Currency', value: terms.currency ?? '—' },
            ]}
          />
        )}

        <Stepper steps={STEPS} current={step} />
      </Card>

      <Card>
        <CardHead
          title={TITLES[step].title}
          hint={TITLES[step].hint}
          right={<Pill tone="blue">{`Step ${step + 1} of 4`}</Pill>}
        />

        <div className="p-5">
          {step === 0 && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="billing-action" required>Billing action</Label>
                    <Select
                      className="w-full"
                      value={kind}
                      onChange={(value) => {
                        setKind(value as typeof kind);
                        setStart('');
                        setEnd('');
                      }}
                      options={KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="contract" required>Contract</Label>
                    <Select
                      className="w-full"
                      searchable
                      placeholder="Select a contract"
                      value={contract}
                      onChange={(value) => {
                        setContract(value);
                        setStart('');
                        setEnd('');
                      }}
                      options={(contracts.data ?? []).map((row) => ({
                        value: row.name,
                        label: `${row.customer} · ${row.name}`,
                        description: [row.billing_frequency, row.billing_timing]
                          .filter(Boolean)
                          .join(' / '),
                      }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="customer">Customer</Label>
                    <input id="customer" readOnly value={terms?.customer ?? ''} className={field} />
                  </div>
                  <div>
                    <Label htmlFor="period-start" required>Period start</Label>
                    <input
                      id="period-start"
                      type="date"
                      value={start}
                      disabled={Boolean(terms?.period_locked)}
                      onChange={(event) => setStart(event.target.value)}
                      className={field}
                    />
                  </div>
                  <div>
                    <Label htmlFor="period-end" required>Period end</Label>
                    <input
                      id="period-end"
                      type="date"
                      value={end}
                      disabled={Boolean(terms?.period_locked)}
                      onChange={(event) => setEnd(event.target.value)}
                      className={field}
                    />
                  </div>
                </div>

                {terms?.note && (
                  <Banner tone={terms.note_tone ?? 'blue'}>{terms.note}</Banner>
                )}

                {terms?.open_run && (
                  <Banner tone="amber" title="A run is already open on this window.">
                    <button
                      type="button"
                      onClick={() => navigate(`/msp/billing/${terms.open_run}`)}
                      className="font-bold underline underline-offset-2"
                    >
                      Continue {terms.open_run} →
                    </button>{' '}
                    rather than drawing a second one.
                  </Banner>
                )}
              </div>

              <InfoPanel>
                <PanelTitle>Contract terms</PanelTitle>
                <Summary
                  rows={[
                    { label: 'Frequency', value: terms?.billing_frequency ?? '—' },
                    { label: 'Timing', value: terms?.billing_timing ?? '—' },
                    { label: 'Proration', value: terms?.proration_method ?? '—' },
                    { label: 'Invoice grouping', value: terms?.invoice_grouping ?? '—' },
                    { label: 'Proposed lines', value: terms?.proposed_lines ?? '—' },
                    {
                      label: 'Estimated amount',
                      value:
                        terms?.proposed_amount === null || terms?.proposed_amount === undefined
                          ? '—'
                          : `${terms.proposed_amount < 0 ? '−' : ''}${money(terms.proposed_amount, currency)}`,
                    },
                  ]}
                />
              </InfoPanel>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {services.isLoading && <p className="text-xs text-slate-400">Reading the services…</p>}
              {services.data?.note && <Banner tone="amber">{services.data.note}</Banner>}

              {kind === 'credit_note' && lines.length > 0 && (
                <Banner tone="amber" title="Credit against coverage already billed.">
                  Keeping a line selected confirms its original coverage, quantity, rate and any
                  credit already given have been checked. Hover a line to read why it is proposed.
                </Banner>
              )}

              {lines.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <strong className="font-bold text-slate-800">{chosen.length} selected</strong>
                  <span className="text-slate-400">of {lines.length} shown</span>
                  <button
                    type="button"
                    onClick={() => {
                      const all = chosen.length === lines.length;
                      setSelected(
                        Object.fromEntries(lines.map((line) => [line.id, !all] as const))
                      );
                    }}
                    className={`${btn} ml-auto`}
                  >
                    {chosen.length === lines.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
              )}

              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {grouped.map(([person, rows]) => (
                  <div key={person}>
                    <div className="flex items-center justify-between gap-2 bg-slate-50/70 px-4 py-1.5">
                      <h3 className="truncate text-[11px] font-bold text-slate-600">{person}</h3>
                      <span className="text-[11px] text-slate-400">
                        {rows.length} service{rows.length > 1 ? 's' : ''}
                      </span>
                    </div>

                    {rows.map((line) => (
                      <label
                        key={line.id}
                        title={line.reason}
                        className="flex cursor-pointer items-center gap-3 border-t border-slate-100 px-4 py-2 hover:bg-slate-50/60"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(selected[line.id])}
                          onChange={(event) =>
                            setSelected((current) => ({
                              ...current,
                              [line.id]: event.target.checked,
                            }))
                          }
                          aria-label={`Include ${line.service} for ${person}`}
                          className="h-4 w-4 shrink-0 accent-blue-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-slate-800">
                            {line.service}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {line.assignment}
                            {line.device ? ` · ${line.device}` : ''}
                          </span>
                        </span>
                        <span className="hidden whitespace-nowrap text-[11px] text-slate-500 sm:block">
                          {day(line.covered_from)} – {day(line.covered_to)}
                        </span>
                        <span className="w-20 shrink-0 text-right text-[11px] text-slate-400">
                          {line.months} mo
                        </span>
                        <span className="hidden shrink-0 lg:block">
                          <Pill tone="gray">{line.covered}</Pill>
                        </span>
                        <strong className="w-28 shrink-0 text-right text-xs font-bold tabular-nums text-slate-800">
                          {line.amount < 0 ? '−' : ''}
                          {money(line.amount, currency)}
                        </strong>
                      </label>
                    ))}
                  </div>
                ))}

                {!services.isLoading && lines.length === 0 && (
                  <p className="p-6 text-center text-xs text-slate-400">
                    Nothing is billable on this window.
                  </p>
                )}
              </div>

              {blocked.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <h3 className="text-xs font-bold text-amber-900">
                    {blocked.length} line{blocked.length > 1 ? 's' : ''} cannot be billed
                  </h3>
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    They are left out of this operation until they are fixed where they live.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {blocked.map((line) => (
                      <li key={line.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                        <Pill tone="amber">{line.exception_code}</Pill>
                        <span className="font-semibold text-slate-700">{line.service}</span>
                        <span className="text-slate-500">{line.person}</span>
                        <span className="text-slate-400">{line.exception_detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="ml-auto flex max-w-xs items-baseline justify-between gap-3 text-xs">
                <span className="text-slate-400">Selected total</span>
                <strong className="text-xl font-bold tabular-nums text-slate-900">
                  {total < 0 ? '−' : ''}
                  {money(total, currency)}
                </strong>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(accounting.data?.dimensions ?? []).map((dimension) => (
                  <div key={dimension.fieldname}>
                    <Label htmlFor={dimension.fieldname} required={dimension.mandatory}>
                      {dimension.label}
                    </Label>
                    <Select
                      className="w-full"
                      placeholder="Not set"
                      value={dimensions[dimension.fieldname] ?? ''}
                      onChange={(value) =>
                        setDimensions((current) => ({ ...current, [dimension.fieldname]: value }))
                      }
                      options={dimension.options.map((option) => ({
                        value: option,
                        label: option,
                      }))}
                    />
                  </div>
                ))}

                <div>
                  <Label htmlFor="posting-date">Posting date</Label>
                  <input
                    id="posting-date"
                    readOnly
                    value={String(accounting.data?.posting_date ?? '').slice(0, 10)}
                    className={field}
                  />
                </div>
                <div>
                  <Label htmlFor="payment-terms">Payment terms</Label>
                  <input
                    id="payment-terms"
                    readOnly
                    value={accounting.data?.payment_terms ?? 'As contracted'}
                    className={field}
                  />
                </div>
                {accounting.data?.currency !== accounting.data?.company_currency && (
                  <div>
                    <Label htmlFor="exchange-rate">Exchange rate</Label>
                    <input
                      id="exchange-rate"
                      type="number"
                      min="0.0001"
                      step="0.01"
                      value={exchange}
                      onChange={(event) => setExchange(event.target.value)}
                      placeholder="From ERPNext"
                      className={field}
                    />
                  </div>
                )}
                {kind !== 'credit_note' && (
                  <div>
                    <Label htmlFor="run-discount">Run discount (%)</Label>
                    <input
                      id="run-discount"
                      type="number"
                      min="0"
                      max="100"
                      value={discount}
                      onChange={(event) => setDiscount(event.target.value)}
                      className={field}
                    />
                  </div>
                )}
              </div>

              <Divider />

              <div>
                <p className="text-xs font-bold text-slate-800">Invoice notifications</p>
                <p className="text-[11px] text-slate-400">
                  Sent when the document is submitted, from its own page.
                </p>
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700">
                    BC
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-bold text-slate-800">
                      {accounting.data?.billing_contact ?? 'No billing contact'}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {accounting.data?.billing_contact_note ?? 'The customer’s billing contact'}
                    </p>
                  </div>
                  <Pill tone={accounting.data?.billing_contact ? 'green' : 'gray'}>To</Pill>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
                ERPNext validates accounting dimensions, exchange rates and posting rules. The
                document is drafted first; submitting it is a separate decision.
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Action', value: label },
                  { label: 'Customer', value: terms?.customer ?? '—' },
                  { label: 'Period', value: `${day(start)} – ${day(end)}` },
                ].map((box) => (
                  <div key={box.label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <p className="text-[11px] text-slate-400">{box.label}</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-800">{box.value}</p>
                  </div>
                ))}
              </div>

              <Summary
                rows={[
                  { label: 'Selected service lines', value: chosen.length },
                  { label: 'Left out', value: lines.length - chosen.length },
                  { label: 'Cannot be billed', value: blocked.length },
                  ...(accounting.data?.dimensions ?? []).map((dimension) => ({
                    label: dimension.label,
                    value: dimensions[dimension.fieldname] || 'Not set',
                  })),
                  {
                    label: 'Notification',
                    value: accounting.data?.billing_contact ?? 'No billing contact',
                  },
                  {
                    label: 'Estimated total (before taxes)',
                    value: `${total < 0 ? '−' : ''}${money(total, currency)}`,
                  },
                ]}
              />

              {kind !== 'credit_note' && (
                <label className="flex items-center gap-2.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={draftInvoice}
                    onChange={(event) => setDraftInvoice(event.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  Draft the Sales Invoice in ERPNext now. Submitting it stays a separate decision.
                </label>
              )}

              <label className="flex items-start gap-2.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-blue-600"
                />
                I have reviewed the services, amounts and accounting details.
              </label>

              {kind === 'credit_note' && (
                <p className="text-[11px] text-slate-400">
                  The credit note stays separate from regular billing and from additions.
                </p>
              )}
            </div>
          )}

          {refused && (
            <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {refused}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
          <button type="button" onClick={back} className={btn}>
            {step === 0 ? '← Billing' : '← Back'}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/msp/billing')} className={btn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void forward()}
              disabled={create.isLoading}
              className={btnPrimary}
            >
              {create.isLoading ? 'Preparing…' : primary}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
