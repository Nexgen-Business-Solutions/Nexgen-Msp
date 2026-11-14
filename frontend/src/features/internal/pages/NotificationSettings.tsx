import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleHelp,
  Clock,
  Mail,
  Plus,
  Satellite,
  Check,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import { useSetPageHeading } from '@/shared/layout/pageHeading';
import RulesTab from '../components/notifications/RulesTab';
import { EMPTY_FILTERS, type RuleFilters } from '../components/notifications/format';
import HistoryTab from '../components/notifications/HistoryTab';
import SourcesTab from '../components/notifications/SourcesTab';
import RuleDrawer from '../components/notifications/RuleDrawer';
import NewRuleModal from '../components/notifications/NewRuleModal';
import { useNotificationOverview } from '../components/notifications/useNotifications';

type TabId = 'rules' | 'history' | 'sources';

const TITLE = 'Email & Notification Settings';
const NEW_RULE_REASON = 'Every notification this application owns is already configured.';

const useDebounced = <T,>(value: T, delay = 300) => {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
};

export default function NotificationSettings() {
  useSetPageHeading(TITLE);

  const [tab, setTab] = useState<TabId>('rules');
  const [filters, setFilters] = useState<RuleFilters>(EMPTY_FILTERS);
  const [open, setOpen] = useState<{ key: string; name?: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const search = useDebounced(filters.search);
  const overview = useNotificationOverview({
    search,
    kind: filters.kind,
    category: filters.category,
    enabled: filters.status,
  });

  const figures = overview.data?.figures;
  const canCreate = overview.data?.can_create ?? [];
  const loading = overview.isLoading;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);

    return () => clearTimeout(timer);
  }, [toast]);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'rules', label: 'Notification rules', count: figures?.managed },
    { id: 'history', label: 'Delivery history' },
    { id: 'sources', label: 'Notification sources' },
  ];

  return (
    <div className="space-y-5 px-6 pb-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-blue-600">Communication control center</p>
          <h1 className="mt-0.5 text-2xl font-bold text-slate-900">{TITLE}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Decide which emails and reminders this application sends, to whom, and how often.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('sources')}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Satellite size={15} aria-hidden />
            View sources
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={canCreate.length === 0}
            aria-describedby={canCreate.length === 0 ? 'new-rule-reason' : undefined}
            title={canCreate.length === 0 ? NEW_RULE_REASON : undefined}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} aria-hidden />
            New rule
          </button>
          {canCreate.length === 0 && (
            <span id="new-rule-reason" className="sr-only">
              {NEW_RULE_REASON}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={BellRing} label="Managed" value={figures?.managed ?? 0} caption="Notifications under control" loading={loading} />
        <KpiCard icon={CheckCircle2} accent="emerald" label="Enabled" value={figures?.enabled ?? 0} caption="Currently sending" loading={loading} />
        <KpiCard icon={Clock} accent="slate" label="Reminders" value={figures?.reminders ?? 0} caption="Repeat on a schedule" loading={loading} />
        <KpiCard icon={Mail} accent="slate" label="Queued" value={figures?.queued ?? 0} caption="Waiting in the mail queue" loading={loading} />
        <KpiCard icon={AlertTriangle} tone="alert" accent="slate" label="Failed" value={figures?.failed ?? 0} caption="Needs a look" loading={loading} onView={() => setTab('history')} viewLabel="Show delivery history" />
        <KpiCard icon={CircleHelp} tone="alert" accent="slate" label="Unknown" value={figures?.unknown ?? 0} caption="Outcome not confirmed" loading={loading} onView={() => setTab('history')} viewLabel="Show delivery history" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        <div role="tablist" aria-label="Notification workspace" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`notif-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`notif-panel-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={`-mb-px inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:bg-blue-50 ${
                tab === entry.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {entry.label}
              {entry.count !== undefined && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                  {entry.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`notif-panel-${tab}`} aria-labelledby={`notif-tab-${tab}`}>
          {tab === 'rules' && (
            <RulesTab
              filters={filters}
              onFilters={(patch) => setFilters((current) => ({ ...current, ...patch }))}
              data={overview.data}
              loading={loading}
              error={overview.error}
              onRetry={() => overview.refetch()}
              onOpen={(rule) => setOpen({ key: rule.rule_key, name: rule.display_name })}
            />
          )}
          {tab === 'history' && <HistoryTab active />}
          {tab === 'sources' && <SourcesTab active />}
        </div>
      </div>

      <NewRuleModal
        open={creating}
        keys={canCreate}
        onClose={() => setCreating(false)}
        onPick={(key) => {
          setCreating(false);
          setOpen({ key });
        }}
      />

      <RuleDrawer
        ruleKey={open?.key ?? null}
        fallbackName={open?.name}
        onClose={() => setOpen(null)}
        onSaved={(message) => {
          setOpen(null);
          setToast(message);
        }}
      />

      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
        {toast && (
          <p className="pointer-events-auto flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
            <Check size={16} className="text-emerald-400" aria-hidden />
            {toast}
          </p>
        )}
      </div>
    </div>
  );
}
