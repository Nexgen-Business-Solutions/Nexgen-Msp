import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Search, SearchX } from 'lucide-react';
import type {
  NotificationLocale,
  NotificationTemplateLocaleState,
  NotificationTemplateRow,
} from '@/lib/api/internal';
import { useNotificationTemplates } from './useNotifications';
import { InfoStrip, Message, Pill, SkeletonRows, btnSmall, inputClass, rowClass, thClass } from './ui';
import { fmtMoment } from './format';
import TemplateEditor from './TemplateEditor';

/** What a language says about itself: never a revision number it does not have. */
const LocaleCell: React.FC<{ state: NotificationTemplateLocaleState }> = ({ state }) => {
  if (!state.configured) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Pill tone="slate">Not configured</Pill>
        {state.has_unpublished_changes && <Pill tone="amber">Draft</Pill>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Pill tone="green">Revision {state.published_revision}</Pill>
      {state.has_unpublished_changes && <Pill tone="amber">Unpublished draft</Pill>}
    </div>
  );
};

const localeOf = (row: NotificationTemplateRow, locale: NotificationLocale) =>
  row.locales.find((entry) => entry.locale === locale);

const TemplatesTab: React.FC<{
  active: boolean;
  /** a template the rule editor asked to open, opened once and then handed back */
  open?: string | null;
  onOpened?: () => void;
}> = ({ active, open, onOpened }) => {
  const templates = useNotificationTemplates(active);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ template: string; locale: NotificationLocale } | null>(
    null
  );

  const locales = templates.data?.locales ?? [];

  useEffect(() => {
    if (!open) return;

    setEditing({ template: open, locale: 'en' });
    onOpened?.();
  }, [open, onOpened]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = templates.data?.rows ?? [];

    if (!needle) return all;

    return all.filter((row) =>
      `${row.template_name} ${row.rule_label} ${row.category}`.toLowerCase().includes(needle)
    );
  }, [templates.data, search]);

  return (
    <div>
      <InfoStrip>
        Each notification has one template, with wording of its own per language. A draft is never
        sent: what goes out is the published revision, and a language with none falls back to the
        original template rather than being translated for you.
      </InfoStrip>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className={`${inputClass} pl-9`}
          />
        </div>
        <p className="rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-slate-200">
          {rows.length} template{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      {templates.isLoading ? (
        <SkeletonRows />
      ) : templates.isError ? (
        <Message tone="error" title="The templates could not be loaded">
          {templates.error instanceof Error ? templates.error.message : undefined}
        </Message>
      ) : rows.length === 0 ? (
        <Message icon={SearchX} title="No template matches that search" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left">
            <thead>
              <tr>
                {['Template', 'Notification', ...locales.map((entry) => entry.label), 'Last modified', ''].map(
                  (head, index) => (
                    <th
                      key={head || `actions-${index}`}
                      scope="col"
                      className={`${thClass} ${index === 0 ? 'pl-5 pr-4 sm:pl-6' : 'px-4'}`}
                    >
                      {head}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.template_name} className={`align-top ${rowClass}`}>
                  <td className="py-3 pl-5 pr-4 sm:pl-6">
                    <p className="text-sm font-semibold text-slate-900">{row.template_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{row.category}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.rule_label}</td>
                  {locales.map((entry) => {
                    const state = localeOf(row, entry.key);

                    return (
                      <td key={entry.key} className="whitespace-nowrap px-4 py-3">
                        {state ? <LocaleCell state={state} /> : <span className="text-slate-400">—</span>}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">
                    {fmtMoment(row.last_edited_at) ?? 'Never'}
                  </td>
                  <td className="whitespace-nowrap py-3 pl-4 pr-5 text-right sm:pr-6">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          template: row.template_name,
                          locale: locales[0]?.key ?? 'en',
                        })
                      }
                      className={btnSmall}
                    >
                      <Pencil size={14} aria-hidden />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TemplateEditor
          templateName={editing.template}
          initialLocale={editing.locale}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

export default TemplatesTab;
