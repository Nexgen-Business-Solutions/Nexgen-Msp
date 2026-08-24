import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  Laptop,
  PlugZap,
  PowerOff,
  Receipt,
  ReceiptText,
  UserPlus,
} from 'lucide-react';
import FilterBar, { type FilterState } from '@/shared/components/FilterBar';
import TablePagination from '@/shared/components/TablePagination';
import type { ActivityKind } from '@/lib/api/internal';
import { useActivity, useActivityOptions } from '../hooks/useActivity';

const TONES: Record<ActivityKind, { icon: typeof Inbox; surround: string; color: string }> = {
  invoice: { icon: Receipt, surround: 'bg-emerald-50', color: 'text-emerald-600' },
  credit_note: { icon: ReceiptText, surround: 'bg-rose-50', color: 'text-rose-600' },
  request: { icon: Inbox, surround: 'bg-blue-50', color: 'text-blue-600' },
  user: { icon: UserPlus, surround: 'bg-indigo-50', color: 'text-indigo-600' },
  device: { icon: Laptop, surround: 'bg-slate-100', color: 'text-slate-600' },
  service_started: { icon: PlugZap, surround: 'bg-emerald-50', color: 'text-emerald-600' },
  service_ended: { icon: PowerOff, surround: 'bg-amber-50', color: 'text-amber-600' },
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

const EMPTY: FilterState = { customers: [], kinds: [], date_from: '', date_to: '' };

export default function ActivityLog() {
  const navigate = useNavigate();
  const options = useActivityOptions();

  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(0);
  const [pageLength, setPageLength] = useState(25);

  const list = useActivity({
    customers: filters.customers as string[],
    kinds: filters.kinds as string[],
    date_from: (filters.date_from as string) || undefined,
    date_to: (filters.date_to as string) || undefined,
    start,
    page_length: pageLength,
  });

  const needle = search.trim().toLowerCase();

  const rows = (list.data?.rows ?? []).filter((event) =>
    needle
      ? `${event.title} ${event.detail} ${event.customer}`.toLowerCase().includes(needle)
      : true
  );

  const apply = (values: FilterState) => {
    setFilters(values);
    setStart(0);
  };

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <FilterBar
        values={filters}
        search={search}
        searchPlaceholder="Search this page of history…"
        subtitle="Narrow the history."
        onSearch={setSearch}
        onApply={apply}
        onClear={() => apply(EMPTY)}
        onRefresh={() => list.refetch()}
        fields={[
          {
            key: 'customers',
            label: 'Customers',
            kind: 'multiselect',
            options: (options.data?.customers ?? []).map((value) => ({ value, label: value })),
          },
          {
            key: 'kinds',
            label: 'Event',
            kind: 'multiselect',
            options: options.data?.kinds ?? [],
          },
          {
            key: 'happened',
            label: 'Happened between',
            kind: 'daterange',
            fromKey: 'date_from',
            toKey: 'date_to',
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Activity</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Joiners, machines, requests and billing, newest first.
          </p>
        </div>

        <div className="px-5 pb-2">
          {list.isLoading && <p className="py-10 text-center text-sm text-slate-500">Loading…</p>}

          {list.error instanceof Error && (
            <p className="py-10 text-center text-sm text-red-600">{list.error.message}</p>
          )}

          {!list.isLoading && !list.error && rows.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">
              Nothing matches these filters.
            </p>
          )}

          <ol className="divide-y divide-slate-100">
            {rows.map((event, index) => {
              const tone = TONES[event.kind] ?? TONES.request;
              const Icon = tone.icon;

              return (
                <li key={`${event.kind}-${event.on}-${index}`}>
                  <button
                    type="button"
                    disabled={!event.link}
                    onClick={() => event.link && navigate(event.link)}
                    className="flex w-full items-start gap-3 px-2 py-3 text-left transition-colors enabled:hover:bg-slate-50 disabled:cursor-default"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.surround}`}
                    >
                      <Icon size={15} className={tone.color} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {event.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{event.detail}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs font-medium text-slate-600 sm:block">
                      {event.customer}
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs text-slate-400">
                      {fmtDate(event.on)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <TablePagination
          start={start}
          pageLength={pageLength}
          total={list.data?.total ?? 0}
          loading={list.isLoading}
          onPrevious={() => setStart(Math.max(start - pageLength, 0))}
          onNext={() => setStart(start + pageLength)}
          onPageLengthChange={(size) => {
            setPageLength(size);
            setStart(0);
          }}
        />
      </div>
    </div>
  );
}
