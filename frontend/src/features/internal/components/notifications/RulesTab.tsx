import React from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import type { NotificationOverview, NotificationRule } from '@/lib/api/internal';
import Select from '@/shared/components/Select';
import { Message, Pill, Segmented, SkeletonRows, inputClass } from './ui';
import { EMPTY_FILTERS, type RuleFilters, fmtMoment, frequencyOf, healthDetail, healthLabel, healthTone, nextDueOf } from './format';
import { Search } from 'lucide-react';
import TablePagination from '@/shared/components/TablePagination';


const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'protected', label: 'Protected' },
];

const HEADS = [
  'Notification',
  'Type',
  'Trigger / condition',
  'Audience',
  'Frequency',
  'Status',
  'Last sent',
  'Next due',
  'Health',
  '',
];

type Props = {
  filters: RuleFilters;
  onFilters: (patch: Partial<RuleFilters>) => void;
  page: number;
  onPage: (page: number) => void;
  data?: NotificationOverview;
  loading: boolean;
  fetching?: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (rule: NotificationRule) => void;
};

const StatusCell: React.FC<{ rule: NotificationRule }> = ({ rule }) => (
  <span className="inline-flex items-center gap-1.5">
    <Pill tone={rule.enabled ? 'green' : 'slate'}>{rule.enabled ? 'Enabled' : 'Disabled'}</Pill>
    {rule.protected && (
      <span title="Protected: cannot be switched off" className="text-slate-400">
        <Lock size={14} aria-label="Protected" />
      </span>
    )}
  </span>
);

const RulesTab: React.FC<Props> = ({ filters, onFilters, page, onPage, data, loading, fetching = false, error, onRetry, onOpen }) => {
  const rules = data?.rules ?? [];
  const filtered = Object.values(filters).some(Boolean);
  const pageLength = data?.page_length || 50;
  const categories = data?.filters.categories ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            aria-label="Search notifications"
            value={filters.search}
            onChange={(event) => onFilters({ search: event.target.value })}
            placeholder="Search a notification, trigger or audience…"
            className={`${inputClass} pl-10`}
          />
        </div>
        <Select
          value={filters.category}
          onChange={(category) => onFilters({ category })}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((entry) => ({ value: entry, label: entry })),
          ]}
          className="w-full min-w-[10rem] sm:w-48"
          searchable={false}
        />
        <Select
          value={filters.status}
          onChange={(status) => onFilters({ status })}
          options={STATUS_OPTIONS}
          className="w-full min-w-[10rem] sm:w-44"
          searchable={false}
        />
        <Segmented
          label="Notification type"
          value={filters.kind}
          onChange={(kind) => onFilters({ kind })}
          options={[
            { value: '', label: 'All' },
            { value: 'Event', label: 'Event emails' },
            { value: 'Reminder', label: 'Reminders' },
          ]}
        />
      </div>

      {loading && !data ? (
        <SkeletonRows />
      ) : error && !data ? (
        <Message
          tone="error"
          title="Notification settings could not be loaded"
          action={
            <button
              type="button"
              onClick={onRetry}
              className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Try again
            </button>
          }
        >
          {error instanceof Error ? error.message : undefined}
        </Message>
      ) : rules.length === 0 ? (
        <Message title={filtered ? 'No notification matches these filters' : 'No notifications are managed yet'}>
          {filtered ? (
            <button
              type="button"
              onClick={() => onFilters(EMPTY_FILTERS)}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              Clear filters
            </button>
          ) : (
            'Notifications this application owns will appear here.'
          )}
        </Message>
      ) : (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[68rem] text-left">
            <thead className="bg-slate-50/70">
              <tr>
                {HEADS.map((head, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500"
                  >
                    {head || <span className="sr-only">Open</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((rule) => {
                const due = nextDueOf(rule);

                return (
                  <tr
                    key={rule.rule_key}
                    tabIndex={0}
                    onClick={() => onOpen(rule)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        onOpen(rule);
                      }
                    }}
                    aria-label={`Open ${rule.display_name}`}
                    className="cursor-pointer transition-colors hover:bg-slate-50 focus:bg-blue-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  >
                    <td className="min-w-[14rem] px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{rule.display_name}</p>
                      <p className="text-xs text-slate-500">{rule.category}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Pill tone={rule.kind === 'Reminder' ? 'amber' : 'blue'}>
                        {rule.kind === 'Reminder' ? 'Reminder' : 'Event email'}
                      </Pill>
                    </td>
                    <td className="max-w-[14rem] truncate px-4 py-3 text-sm text-slate-600" title={rule.trigger_key}>
                      {rule.trigger_label || rule.trigger_key}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <p className="whitespace-nowrap">{rule.audience_label || '—'}</p>
                      {rule.cc.length > 0 && (
                        <p className="text-xs text-slate-400">CC {rule.cc.length}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{frequencyOf(rule)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusCell rule={rule} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-500">
                      {fmtMoment(rule.last_sent) ?? 'Never'}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-sm tabular-nums ${
                        due.muted ? 'text-slate-400' : 'text-slate-700'
                      }`}
                    >
                      {due.text}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Pill tone={healthTone(rule.health)} title={healthDetail(rule.health)}>
                        {healthLabel(rule.health)}
                      </Pill>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <ChevronRight size={16} aria-hidden />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && (
        <TablePagination
          start={page * pageLength}
          pageLength={pageLength}
          total={data.total}
          loading={fetching}
          onPrevious={() => onPage(Math.max(page - 1, 0))}
          onNext={() => onPage(page + 1)}
        />
      )}

    </div>
  );
};

export default RulesTab;
