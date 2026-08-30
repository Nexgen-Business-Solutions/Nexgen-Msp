import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Info,
  Receipt,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import FieldLabel from '@/shared/components/FieldLabel';
import Select from '@/shared/components/Select';
import MultiSelect from '@/shared/components/MultiSelect';
import StatusBadge from '@/shared/components/StatusBadge';
import type { BillingFilters } from '@/lib/api/internal';
import { useMspContracts } from '../hooks/useMspContracts';
import {
  useBillingFilterOptions,
  useBillingPeriodStatus,
  useGenerateRun,
  usePreviewRun,
} from '../hooks/useBilling';

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const STEPS = ['Period', 'Selection'];

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const previousMonth = () => {
  const now = new Date();
  return {
    start: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
};

const previousQuarter = () => {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) - 1;
  const year = quarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = ((quarter % 4) + 4) % 4 * 3;
  return {
    start: iso(new Date(year, month, 1)),
    end: iso(new Date(year, month + 3, 0)),
  };
};

const currentQuarter = () => {
  const now = new Date();
  const month = Math.floor(now.getMonth() / 3) * 3;
  return {
    start: iso(new Date(now.getFullYear(), month, 1)),
    end: iso(new Date(now.getFullYear(), month + 3, 0)),
  };
};

const restOfThisMonth = () => {
  const now = new Date();
  return {
    start: iso(now),
    end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const nextMonth = () => {
  const now = new Date();
  return {
    start: iso(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    end: iso(new Date(now.getFullYear(), now.getMonth() + 2, 0)),
  };
};

const thisYear = () => {
  const now = new Date();
  return {
    start: iso(new Date(now.getFullYear(), 0, 1)),
    end: iso(new Date(now.getFullYear(), 11, 31)),
  };
};

const nextTwelveMonths = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: iso(start),
    end: iso(new Date(start.getFullYear() + 1, start.getMonth(), 0)),
  };
};

const PRESETS = [
  { label: 'Rest of this month', build: restOfThisMonth },
  { label: 'Next month', build: nextMonth },
  { label: 'Last month', build: previousMonth },
  { label: 'Last quarter', build: previousQuarter },
  { label: 'This quarter', build: currentQuarter },
  { label: 'This year', build: thisYear },
  { label: 'One year ahead', build: nextTwelveMonths },
];

export default function NewBillingRun() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contracts = useMspContracts({ billable_only: 1 });
  const preview = usePreviewRun();
  const generate = useGenerateRun();

  // arriving from "Bill this period" carries the contract and the period to cover
  const defaults = previousQuarter();
  const [step, setStep] = useState(0);
  const [contract, setContract] = useState(searchParams.get('contract') ?? '');
  const [start, setStart] = useState(searchParams.get('start') ?? defaults.start);
  const [end, setEnd] = useState(searchParams.get('end') ?? defaults.end);
  const [filters, setFilters] = useState<BillingFilters>({ only_billable: 1 });
  const [advanced, setAdvanced] = useState(false);
  const [discount, setDiscount] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const chosen = (contracts.data ?? []).find((row) => row.name === contract);
  const options = useBillingFilterOptions(chosen?.customer);

  // nothing to choose between when every service here is billed the same way
  const scopes = options.data?.billed_to ?? [];

  // a run can only cover what the contract itself covers
  const windowStart = chosen?.start_date?.slice(0, 10);
  const windowEnd = chosen?.end_date?.slice(0, 10);
  const outsideWindow = Boolean(
    chosen &&
      ((windowStart && start && start < windowStart) || (windowEnd && end && end > windowEnd))
  );

  // asked as soon as a period is set, so an already-covered stretch shows before generating
  const coverage = useBillingPeriodStatus(contract, start, end, step === 0 && !outsideWindow);

  // a discount can come from the rate as well as from this run, so the column shows
  // whenever a line actually carries one
  const hasDiscount =
    Number(discount || 0) > 0 ||
    (preview.data?.lines ?? []).some((line) => Number(line.discount_percent || 0) > 0);

  const resultColumns = [
    '',
    'User',
    'Service',
    ...(scopes.length > 1 ? ['Billed to'] : []),
    'Device',
    'Last billed',
    'Months',
    'Rate',
    ...(hasDiscount ? ['Discount'] : []),
    'Amount',
  ];

  const result = preview.data;
  const lines = result?.lines ?? [];
  const billable = lines.filter((line) => !line.exception_code);
  const kept = billable.filter((line) => !excluded.has(line.service_assignment));
  // an untick made under one filter still holds under the next, so some of them are
  // out of sight; saying how many keeps the count below honest
  const hiddenExcluded =
    excluded.size - billable.filter((line) => excluded.has(line.service_assignment)).length;
  // a line a filter hides is not billed either, though nobody unticked it
  const hiddenByFilter = Math.max(
    (result?.available ?? 0) - (result?.blocked_count ?? 0) - billable.length,
    0
  );
  const keptTotal = kept.reduce((sum, line) => sum + line.amount, 0);
  const keptMonths = kept.reduce((sum, line) => sum + line.billable_months, 0);

  // the invoice is read service by service before it is read person by person, so the run
  // says how many of each it carries before listing who they belong to
  const perService = useMemo(() => {
    const tally = new Map<string, { name: string; count: number; months: number; amount: number }>();

    for (const line of kept) {
      const key = line.service_item;
      const row = tally.get(key) ?? { name: line.service_name || key, count: 0, months: 0, amount: 0 };
      row.count += 1;
      row.months += line.billable_months;
      row.amount += line.amount;
      tally.set(key, row);
    }

    return [...tally.values()].sort((a, b) => b.amount - a.amount);
  }, [kept]);

  const set = (patch: Partial<BillingFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  const run = useMemo(
    () => ({
      contract,
      period_start: start,
      period_end: end,
      discount_percent: Number(discount || 0),
    }),
    [contract, start, end, discount]
  );

  // what was unticked is a decision about people, not about the current view: it survives
  // every filter, and only a change of period wipes it, because the lines are then not the same
  const scope = `${contract}|${start}|${end}`;
  const lastScope = useRef(scope);

  useEffect(() => {
    if (step !== 1) return;

    if (lastScope.current !== scope) {
      lastScope.current = scope;
      setExcluded(new Set());
    }

    preview.mutate({ ...run, filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, filters, run]);

  const toggle = (assignment: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(assignment)) next.delete(assignment);
      else next.add(assignment);
      return next;
    });

  const submit = async () => {
    try {
      const created = await generate.mutateAsync({
        ...run,
        include: kept.map((line) => line.service_assignment),
      });
      navigate(`/msp/billing/${created.name}`);
    } catch {
      // surfaced below
    }
  };

  const error = (preview.error || generate.error) as Error | undefined;
  const canContinue = Boolean(contract && start && end) && !outsideWindow;

  const advancedCount = [
    filters.device_types?.length,
    filters.departments?.length,
    filters.user_statuses?.length,
    filters.started_after || filters.started_before ? 1 : 0,
    filters.last_billed_after || filters.last_billed_before ? 1 : 0,
  ].reduce<number>((sum, value) => sum + (value ? 1 : 0), 0);

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <button
        type="button"
        onClick={() => navigate('/msp/billing')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Back to billing runs
      </button>

      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              disabled={index > 0 && !canContinue}
              onClick={() => setStep(index)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                index === step
                  ? 'bg-blue-600 text-white'
                  : index < step
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  index === step
                    ? 'bg-white/20'
                    : index < step
                      ? 'bg-emerald-100'
                      : 'bg-slate-100'
                }`}
              >
                {index < step ? <Check size={12} /> : index + 1}
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">What are we billing?</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              One contract, one invoice. Only the services the contract covers are picked up.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 px-5 sm:grid-cols-3">
            <div>
              <FieldLabel required>Contract</FieldLabel>
              <Select
                className="w-full"
                searchable
                value={contract}
                onChange={setContract}
                placeholder="Select a contract"
                options={(contracts.data ?? []).map((row) => ({
                  value: row.name,
                  label: row.title || row.customer,
                  description: `${row.customer} · ${row.billing_frequency} · ${row.service_count ?? 0} service(s)`,
                }))}
              />
              {(contracts.data ?? []).length === 0 && !contracts.isLoading && (
                <p className="mt-1.5 text-xs text-amber-600">No active contract yet.</p>
              )}
            </div>
            <div>
              <FieldLabel required>Period start</FieldLabel>
              <input
                type="date"
                value={start}
                min={windowStart}
                max={end || windowEnd}
                onChange={(event) => setStart(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel required>Period end</FieldLabel>
              <input
                type="date"
                value={end}
                min={start || windowStart}
                max={windowEnd}
                onChange={(event) => setEnd(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {!outsideWindow && coverage.data?.fully_billed && (
            <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">
                  {coverage.data.customer} is already billed for this whole period.
                </span>{' '}
                All {coverage.data.eligible} eligible line(s) sit on{' '}
                {coverage.data.runs.join(', ')}. Generating again would produce a run with
                nothing on it.
              </p>
            </div>
          )}

          {!outsideWindow &&
            coverage.data &&
            !coverage.data.fully_billed &&
            coverage.data.already_billed > 0 && (
              <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-lg border border-blue-100 bg-blue-50/70 p-3">
                <Info size={16} className="mt-0.5 shrink-0 text-blue-600" />
                <p className="text-sm text-blue-800">
                  {coverage.data.already_billed} of {coverage.data.eligible} line(s) are already
                  billed for this period on {coverage.data.runs.join(', ')}.{' '}
                  <span className="font-semibold">{coverage.data.remaining} remain</span> to bill.
                </p>
              </div>
            )}

          {outsideWindow && (
            <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">
                This contract only covers {windowStart} to {windowEnd ?? 'an open end'}. A period
                outside that window cannot be billed under it.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  const range = preset.build();
                  setStart(range.start);
                  setEnd(range.end);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {chosen && (
            <div className="border-t border-slate-100 px-5 py-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Customer</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{chosen.customer}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Frequency</dt>
                  <dd className="mt-0.5 text-slate-700">{chosen.billing_frequency}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Proration</dt>
                  <dd className="mt-0.5 text-slate-700">{chosen.proration_method}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Currency</dt>
                  <dd className="mt-0.5 text-slate-700">{chosen.currency}</dd>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Services covered</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {chosen.services.map((service) => (
                      <span
                        key={service.service_item}
                        className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                      >
                        {service.service_name}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
                <SlidersHorizontal size={16} className="text-slate-400" />
                Narrow the run
              </h2>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {result?.matched ?? 0}
                  <span className="text-sm font-normal text-slate-400">
                    {' '}
                    / {result?.available ?? 0}
                  </span>
                </p>
                <p className="text-xs text-slate-400">lines matched</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-5 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <FieldLabel>Service</FieldLabel>
                <MultiSelect
                  searchable
                  values={filters.services ?? []}
                  onChange={(values) => set({ services: values })}
                  options={options.data?.services ?? []}
                  placeholder="Every service"
                />
              </div>
              {scopes.length > 1 && (
                <div>
                  <FieldLabel>Billed to</FieldLabel>
                  <MultiSelect
                    values={filters.billed_to ?? []}
                    onChange={(values) => set({ billed_to: values })}
                    options={scopes.map((v) => ({
                      value: v,
                      label: v === 'User' ? 'The person' : 'The machine',
                    }))}
                    placeholder="Person and machine"
                  />
                </div>
              )}
              <div>
                <FieldLabel>Service status</FieldLabel>
                <MultiSelect
                  values={filters.statuses ?? []}
                  onChange={(values) => set({ statuses: values })}
                  options={(options.data?.statuses ?? []).map((v) => ({ value: v, label: v }))}
                  placeholder="Any status"
                />
              </div>
              <div>
                <FieldLabel>Discount on this run</FieldLabel>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                    placeholder="0"
                    className={`${inputClass} text-right tabular-nums`}
                  />
                  <span className="text-sm text-slate-500">%</span>
                </div>
              </div>
              <div className="flex items-end pb-1">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(filters.only_billable)}
                    onChange={(event) => set({ only_billable: event.target.checked ? 1 : 0 })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Hide blocked lines
                </label>
              </div>
            </div>

            <div className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAdvanced((current) => !current)}
                className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <span className="inline-flex items-center gap-2">
                  Advanced filters
                  {advancedCount > 0 && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                      {advancedCount}
                    </span>
                  )}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 transition-transform ${advanced ? 'rotate-180' : ''}`}
                />
              </button>

              {advanced && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-5 border-t border-slate-100 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <FieldLabel>Department</FieldLabel>
                    <MultiSelect
                      searchable
                      values={filters.departments ?? []}
                      onChange={(values) => set({ departments: values })}
                      options={(options.data?.departments ?? []).map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      placeholder="Any department"
                    />
                  </div>
                  <div>
                    <FieldLabel>Device type</FieldLabel>
                    <MultiSelect
                      searchable
                      values={filters.device_types ?? []}
                      onChange={(values) => set({ device_types: values })}
                      options={(options.data?.device_types ?? []).map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      placeholder="Any equipment"
                    />
                  </div>
                  <div>
                    <FieldLabel>Person status</FieldLabel>
                    <MultiSelect
                      values={filters.user_statuses ?? []}
                      onChange={(values) => set({ user_statuses: values })}
                      options={(options.data?.user_statuses ?? []).map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      placeholder="Any"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel>In service between</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={filters.started_after ?? ''}
                        max={filters.started_before || undefined}
                        onChange={(event) => set({ started_after: event.target.value || undefined })}
                        className={inputClass}
                      />
                      <span className="text-sm text-slate-400">→</span>
                      <input
                        type="date"
                        value={filters.started_before ?? ''}
                        min={filters.started_after || undefined}
                        onChange={(event) =>
                          set({ started_before: event.target.value || undefined })
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel>Last billed between</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={filters.last_billed_after ?? ''}
                        max={filters.last_billed_before || undefined}
                        onChange={(event) =>
                          set({ last_billed_after: event.target.value || undefined })
                        }
                        className={inputClass}
                      />
                      <span className="text-sm text-slate-400">→</span>
                      <input
                        type="date"
                        value={filters.last_billed_before ?? ''}
                        min={filters.last_billed_after || undefined}
                        onChange={(event) =>
                          set({ last_billed_before: event.target.value || undefined })
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="flex items-end pb-1">
                    <button
                      type="button"
                      onClick={() => setFilters({ only_billable: 1 })}
                      className="text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
                    >
                      Reset filters
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Who gets billed</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  Untick anyone you want to leave out. It sticks when you change the filters.
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {keptTotal.toLocaleString()}{' '}
                  <span className="text-sm font-normal text-slate-400">
                    {result?.currency ?? ''}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  {kept.length} of {billable.length} lines · {keptMonths.toFixed(1)} months
                  {hiddenExcluded > 0 && (
                    <span className="text-amber-600">
                      {' '}
                      · {hiddenExcluded} unticked out of view
                    </span>
                  )}
                </p>
              </div>
            </div>

            {perService.length > 0 && (
              <div className="sticky top-2 z-20 border-y border-slate-100 bg-slate-50/95 px-5 py-3 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    What this run carries
                  </p>
                  <p className="text-xs text-slate-400">
                    {perService.length} service{perService.length > 1 ? 's' : ''} · {kept.length}{' '}
                    line{kept.length > 1 ? 's' : ''}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {perService.map((row) => (
                    <div
                      key={row.name}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {row.count}
                        <span className="ml-1.5 font-medium text-slate-500">{row.name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                        {row.months.toFixed(1)} months · {row.amount.toLocaleString()}{' '}
                        {result?.currency ?? ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result && result.blocked_count > 0 && (
              <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold">
                    {result.blocked_count} line(s) cannot be billed
                    {filters.only_billable ? ' and are hidden below' : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(result.blocked_by_code).map(([code, count]) => (
                      <li key={code}>
                        {count} × {code}
                      </li>
                    ))}
                  </ul>
                  {Boolean(filters.only_billable) && (
                    <button
                      type="button"
                      onClick={() => set({ only_billable: 0 })}
                      className="mt-2 inline-flex items-center rounded-lg border border-amber-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      Show them
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
              <div className="relative flex-1 min-w-[14rem]">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={filters.search ?? ''}
                  onChange={(event) => set({ search: event.target.value || undefined })}
                  placeholder="Search this selection"
                  className="h-10 w-full rounded-lg border border-slate-200 pl-10 pr-4 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(billable.map((line) => line.service_assignment)))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>

            <div className="max-h-[30rem] overflow-auto px-5 pb-5">
              <table className="w-full">
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50">
                  <tr>
                    {resultColumns.map((column, index) => (
                      <th
                        key={column || index}
                        className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                          index >= resultColumns.length - 3 ? 'text-right' : 'text-left'
                        } ${index === 0 ? 'rounded-l-lg' : ''} ${
                          index === resultColumns.length - 1 ? 'rounded-r-lg' : ''
                        }`}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {billable.map((line) => (
                    <tr key={line.service_assignment} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={!excluded.has(line.service_assignment)}
                          onChange={() => toggle(line.service_assignment)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <p className="text-sm font-medium text-slate-800">
                          {line.user_name || 'N/A'}
                        </p>
                        {line.department && (
                          <p className="text-xs text-slate-400">{line.department}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                        {line.service_name}
                      </td>
                      {scopes.length > 1 && (
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <StatusBadge value={line.billed_to === 'Device' ? 'Device' : 'User'} />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                        {line.hostname || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-500">
                        {line.last_billed_on ? line.last_billed_on.slice(0, 10) : 'Never'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-slate-700 tabular-nums">
                        {line.billable_months}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-slate-500 tabular-nums">
                        {(line.unit_rate ?? 0).toLocaleString()}
                      </td>
                      {hasDiscount && (
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-slate-600 tabular-nums">
                          {line.discount_percent ? (
                            <div className="flex flex-col items-end">
                              <span>{line.discount_percent}%</span>
                              {line.discount_source && (
                                <span className="text-xs font-medium text-slate-400">
                                  {line.discount_source.toLowerCase()}
                                </span>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold text-slate-900 tabular-nums">
                        {line.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {billable.length === 0 && (
                    <tr>
                      <td
                        colSpan={resultColumns.length}
                        className="px-3 py-10 text-center text-sm text-slate-500"
                      >
                        Nothing matches these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 1 && hiddenByFilter > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">
              {hiddenByFilter} billable line(s) are held back by the filters
            </span>{' '}
            and will not be on this run. Clear the filters to bill them too.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm font-medium text-red-700">{error.message}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {step === 0 ? (
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => setStep(1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue
            <ArrowRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={kept.length === 0 || generate.isLoading}
            className="inline-flex min-w-[11rem] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generate.isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <>
                <Receipt size={15} />
                Generate the run
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
