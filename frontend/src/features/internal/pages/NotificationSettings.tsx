import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleHelp,
  Clock,
  Mail,
  Hourglass,
  Info,
  Plus,
  Satellite,
  Send,
  Check,
} from 'lucide-react';
import KpiCard from '@/shared/components/KpiCard';
import Modal from '@/shared/components/Modal';
import { useSetPageHeading } from '@/shared/layout/pageHeading';
import RulesTab from '../components/notifications/RulesTab';
import { btnPrimary, btnSecondary } from '../components/notifications/ui';
import { EMPTY_FILTERS, EMPTY_HISTORY_FILTERS, type HistoryFilters, type RuleFilters } from '../components/notifications/format';
import HistoryTab from '../components/notifications/HistoryTab';
import SourcesTab from '../components/notifications/SourcesTab';
import TemplatesTab from '../components/notifications/TemplatesTab';
import RuleDrawer from '../components/notifications/RuleDrawer';
import NewRuleModal from '../components/notifications/NewRuleModal';
import { useNotificationOverview } from '../components/notifications/useNotifications';

type TabId = 'rules' | 'templates' | 'history' | 'sources';

const PAGE_LENGTH = 50;
const TITLE = 'Email Management';
const NEW_RULE_REASON = 'Every notification this application owns is already configured.';
const NEW_RULE_EXPLAINED = [
  'A rule here stands for something the application already knows how to send. All of them are configured, so there is nothing left to create.',
  'A new one appears when the application learns to send something new.',
  'To change who is written to, or how often a reminder repeats, open the rule itself.',
];

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
  const [rulesPage, setRulesPage] = useState(0);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [historyPage, setHistoryPage] = useState(0);
  const [open, setOpen] = useState<{ key: string; name?: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [wording, setWording] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const search = useDebounced(filters.search);
  const overview = useNotificationOverview({
    search,
    kind: filters.kind,
    category: filters.category,
    enabled: filters.status,
    page: rulesPage,
    page_length: PAGE_LENGTH,
  });

  const showRules = (next: RuleFilters) => {
    setFilters(next);
    setRulesPage(0);
    setTab('rules');
  };

  const showHistory = (status: string) => {
    setHistoryFilters({ search: '', status });
    setHistoryPage(0);
    setTab('history');
  };

  const figures = overview.data?.figures;
  const canCreate = overview.data?.can_create ?? [];
  const [explainingNewRule, setExplainingNewRule] = useState(false);
  const loading = overview.isLoading;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);

    return () => clearTimeout(timer);
  }, [toast]);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'rules', label: 'Notification rules', count: figures?.managed },
    { id: 'templates', label: 'Templates' },
    { id: 'history', label: 'Delivery history' },
    { id: 'sources', label: 'Notification sources' },
  ];

  return (
    <div className="space-y-6 px-6 pb-6 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="hidden size-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 sm:grid">
            <Mail className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-blue-600">Communication control center</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">{TITLE}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Decide which emails and reminders this application sends, to whom, and how often.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTab('sources')} className={btnSecondary}>
            <Satellite size={15} aria-hidden />
            View sources
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={canCreate.length === 0}
            aria-describedby={canCreate.length === 0 ? 'new-rule-reason' : undefined}
            title={canCreate.length === 0 ? NEW_RULE_REASON : undefined}
            className={btnPrimary}
          >
            <Plus size={15} aria-hidden />
            New rule
          </button>
          {canCreate.length === 0 && (
            <>
              <button
                type="button"
                onClick={() => setExplainingNewRule(true)}
                aria-label="Why New rule is unavailable"
                title={NEW_RULE_REASON}
                className="grid size-10 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Info size={15} aria-hidden />
              </button>
              <span id="new-rule-reason" className="sr-only">
                {NEW_RULE_REASON}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[3fr_5fr]">
        <section className="min-w-0 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Rules at a glance</h2>
            <p className="mt-0.5 text-sm text-slate-500">What this application sends, and how much of it is switched on.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard icon={BellRing} label="Managed" value={figures?.managed ?? 0} caption="Notifications under control" loading={loading} onView={() => showRules(EMPTY_FILTERS)} viewLabel="Show all notification rules" />
            <KpiCard icon={CheckCircle2} accent="emerald" label="Enabled" value={figures?.enabled ?? 0} caption="Currently sending" loading={loading} onView={() => showRules({ ...EMPTY_FILTERS, status: 'enabled' })} viewLabel="Show enabled notification rules" />
            <KpiCard icon={Clock} accent="indigo" label="Reminders" value={figures?.reminders ?? 0} caption="Repeat on a schedule" loading={loading} onView={() => showRules({ ...EMPTY_FILTERS, kind: 'Reminder' })} viewLabel="Show reminder rules" />
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Delivery outcomes</h2>
            <p className="mt-0.5 text-sm text-slate-500">Where send attempts stand. Open one to see the deliveries behind it.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-3 2xl:grid-cols-5">
            <KpiCard icon={Hourglass} accent="slate" label="Pending" value={figures?.pending ?? 0} caption="Recorded, not yet taken" loading={loading} onView={() => showHistory('Pending')} viewLabel="Show pending deliveries" />
            <KpiCard icon={Mail} accent="sky" label="Queued" value={figures?.queued ?? 0} caption="Handed to the mail queue" loading={loading} onView={() => showHistory('Queued')} viewLabel="Show queued deliveries" />
            <KpiCard icon={Send} accent="emerald" label="Sent" value={figures?.sent ?? 0} caption="Left the queue" loading={loading} onView={() => showHistory('Sent')} viewLabel="Show sent deliveries" />
            <KpiCard icon={AlertTriangle} tone="alert" accent="slate" label="Failed" value={figures?.failed ?? 0} caption="Needs a look" loading={loading} onView={() => showHistory('Failed')} viewLabel="Show failed deliveries" />
            <KpiCard icon={CircleHelp} tone="alert" accent="slate" label="Unknown" value={figures?.unknown ?? 0} caption="Outcome not confirmed" loading={loading} onView={() => showHistory('Unknown')} viewLabel="Show deliveries with an unknown outcome" />
          </div>
        </section>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div role="tablist" aria-label="Notification workspace" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 sm:px-4">
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
                  ? 'border-blue-500 text-slate-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {entry.label}
              {entry.count !== undefined && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ${
                    tab === entry.id
                      ? 'bg-blue-50 text-blue-700 ring-blue-200'
                      : 'bg-slate-50 text-slate-600 ring-slate-200'
                  }`}
                >
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
              onFilters={(patch) => {
                setFilters((current) => ({ ...current, ...patch }));
                setRulesPage(0);
              }}
              page={rulesPage}
              onPage={setRulesPage}
              data={overview.data}
              loading={loading}
              fetching={overview.isFetching}
              error={overview.error}
              onRetry={() => overview.refetch()}
              onOpen={(rule) => setOpen({ key: rule.rule_key, name: rule.display_name })}
            />
          )}
          {tab === 'templates' && (
            <TemplatesTab active open={wording} onOpened={() => setWording(null)} />
          )}
          {tab === 'history' && (
            <HistoryTab
              active
              filters={historyFilters}
              onFilters={(patch) => {
                setHistoryFilters((current) => ({ ...current, ...patch }));
                setHistoryPage(0);
              }}
              page={historyPage}
              onPage={setHistoryPage}
            />
          )}
          {tab === 'sources' && <SourcesTab active />}
        </div>
      </div>

      <Modal
        open={explainingNewRule}
        onClose={() => setExplainingNewRule(false)}
        icon={Info}
        tone="slate"
        title="Why New rule is unavailable"
        widthClass="max-w-lg"
      >
        <div className="space-y-2">
          {NEW_RULE_EXPLAINED.map((line) => (
            <p key={line} className="text-sm text-slate-600">
              {line}
            </p>
          ))}
        </div>
      </Modal>

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
        onOpenTemplate={(templateName) => {
          setOpen(null);
          setWording(templateName);
          setTab('templates');
        }}
      />

      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
        {toast && (
          <p className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
            <Check size={16} className="text-emerald-400" aria-hidden />
            {toast}
          </p>
        )}
      </div>
    </div>
  );
}
