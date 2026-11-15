import React, { useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import TablePagination from '@/shared/components/TablePagination';
import Select from '@/shared/components/Select';
import InvestigateDelivery from './InvestigateDelivery';
import { useNotificationHistory } from './useNotifications';
import { InfoStrip, Message, Pill, SkeletonRows, inputClass } from './ui';
import { EMPTY_HISTORY_FILTERS, type HistoryFilters, STATE_MEANING, fmtMoment, stateTone } from './format';

const DEFAULT_STATES = ['Pending', 'Queued', 'Sent', 'Failed', 'Skipped', 'Unknown'];

const HEADS = ['Time', 'Rule', 'Business record', 'Recipient', 'Template / subject', 'Attempt', 'State', 'Details', 'Action'];

type Props = {
  active: boolean;
  filters: HistoryFilters;
  onFilters: (patch: Partial<HistoryFilters>) => void;
  page: number;
  onPage: (page: number) => void;
};

const PAGE_LENGTH = 50;

const HistoryTab: React.FC<Props> = ({ active, filters, onFilters, page, onPage }) => {
  const { search, status } = filters;
  const history = useNotificationHistory({ search, status, page, page_length: PAGE_LENGTH }, active);
  const [investigating, setInvestigating] = useState<string | null>(null);
  const pageLength = history.data?.page_length || PAGE_LENGTH;
  const rows = history.data?.rows ?? [];
  const states = history.data?.statuses?.length ? history.data.statuses : DEFAULT_STATES;

  return (
    <div>
      <InfoStrip>
        Delivery status is what the system actually knows. &ldquo;Queued&rdquo; means the message was
        accepted into Frappe&apos;s email queue. &ldquo;Sent&rdquo; does not prove it reached an inbox.
      </InfoStrip>

      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            aria-label="Search delivery history"
            value={search}
            onChange={(event) => onFilters({ search: event.target.value })}
            placeholder="Search a recipient or business record…"
            className={`${inputClass} pl-10`}
          />
        </div>
        <Select
          value={status}
          onChange={(next) => onFilters({ status: next })}
          options={[
            { value: '', label: 'All delivery states' },
            ...states.map((entry) => ({ value: entry, label: entry })),
          ]}
          className="w-full min-w-[10rem] sm:w-52"
          searchable={false}
        />
        {(search || status) && (
          <button
            type="button"
            onClick={() => onFilters(EMPTY_HISTORY_FILTERS)}
            className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          onClick={() => history.refetch()}
          disabled={history.isFetching}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw size={16} className={history.isFetching ? 'motion-safe:animate-spin' : ''} aria-hidden />
          Refresh
        </button>
      </div>

      {history.isLoading ? (
        <SkeletonRows />
      ) : history.isError && !history.data ? (
        <Message tone="error" title="Delivery history could not be loaded">
          {history.error instanceof Error ? history.error.message : undefined}
        </Message>
      ) : rows.length === 0 ? (
        <Message title={search || status ? 'No delivery matches these filters' : 'Nothing has been sent yet'}>
          {search || status ? undefined : 'Every send attempt of a managed notification is recorded here.'}
        </Message>
      ) : (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[64rem] text-left">
            <thead className="bg-slate-50/70">
              <tr>
                {HEADS.map((head) => (
                  <th key={head} scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const reason = row.failure_reason || row.skip_reason;

                return (
                  <tr key={row.name} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-500">
                      {fmtMoment(row.sent_at || row.queued_at || row.creation)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.rule}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {row.business_name || '—'}
                      {row.business_doctype && <p className="text-xs text-slate-400">{row.business_doctype}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.recipient || '—'}</td>
                    <td className="max-w-[16rem] px-4 py-3 text-sm text-slate-600">
                      <p className="truncate" title={row.subject_snapshot ?? undefined}>
                        {row.subject_snapshot || '—'}
                      </p>
                      <p className="truncate text-xs text-slate-400">{row.template_name}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                      {row.attempt ?? 1}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Pill tone={stateTone(row.status)} title={STATE_MEANING[row.status]}>
                          {row.status}
                        </Pill>
                        {Boolean(row.is_test) && <Pill>Test</Pill>}
                      </span>
                    </td>
                    <td className="max-w-[18rem] px-4 py-3 text-sm text-slate-500">
                      {reason && <p className="break-words">{reason}</p>}
                      {row.email_queue_id && (
                        <p className="text-xs text-slate-400">Queue {row.email_queue_id}</p>
                      )}
                      {!reason && !row.email_queue_id && '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {(row.status === 'Unknown' || row.status === 'Failed') && (
                        <button
                          type="button"
                          aria-label={`Investigate ${row.name}`}
                          onClick={() => setInvestigating(row.name)}
                          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Investigate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {history.data && history.data.total > 0 && (
        <TablePagination
          start={page * pageLength}
          pageLength={pageLength}
          total={history.data.total}
          loading={history.isFetching}
          onPrevious={() => onPage(Math.max(page - 1, 0))}
          onNext={() => onPage(page + 1)}
        />
      )}

      <InvestigateDelivery dispatch={investigating} onClose={() => setInvestigating(null)} />
    </div>
  );
};

export default HistoryTab;
