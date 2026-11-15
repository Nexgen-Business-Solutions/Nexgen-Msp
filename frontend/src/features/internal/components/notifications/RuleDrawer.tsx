import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical, Lock, RefreshCw, X } from 'lucide-react';
import { FrappeError } from '@/lib/api/client';
import type {
  NotificationRuleChanges,
  NotificationRuleDetail,
  NotificationRuleFields,
} from '@/lib/api/internal';
import Select from '@/shared/components/Select';
import {
  useNotificationEligibility,
  useNotificationPreview,
  useNotificationRule,
  useSaveNotificationRule,
  useTestNotificationRule,
} from './useNotifications';
import { Field, inputClass, Message, Pill, SkeletonRows, Switch } from './ui';
import { fmtMoment, healthLabel, healthTone, splitCsv } from './format';

type PanelId = 'configuration' | 'preview' | 'activity';

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'preview', label: 'Preview' },
  { id: 'activity', label: 'Activity' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NONE = '';

type Draft = {
  enabled: boolean;
  display_name: string;
  template_name: string;
  audience_key: string;
  to: string;
  cc: string;
  initial_delay_value: string;
  initial_delay_unit: string;
  repeat_interval_value: string;
  repeat_interval_unit: string;
  max_sends: string;
  timezone: string;
  stop_condition_key: string;
  escalation_audience_key: string;
  escalation_after_iteration: string;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
};

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

const draftOf = (rule: NotificationRuleFields): Draft => ({
  enabled: Boolean(rule.enabled),
  display_name: text(rule.display_name),
  template_name: text(rule.template_name),
  audience_key: text(rule.audience_key),
  to: (rule.extra ?? []).join(', '),
  cc: (rule.cc ?? []).join(', '),
  initial_delay_value: text(rule.initial_delay_value),
  initial_delay_unit: text(rule.initial_delay_unit),
  repeat_interval_value: text(rule.repeat_interval_value),
  repeat_interval_unit: text(rule.repeat_interval_unit),
  max_sends: text(rule.max_sends),
  timezone: text(rule.timezone),
  stop_condition_key: text(rule.stop_condition_key),
  escalation_audience_key: text(rule.escalation_audience_key),
  escalation_after_iteration: text(rule.escalation_after_iteration),
  quiet_hours_enabled: Boolean(rule.quiet_hours_enabled),
  quiet_start: text(rule.quiet_start).slice(0, 5),
  quiet_end: text(rule.quiet_end).slice(0, 5),
});

const NUMBERS = [
  'initial_delay_value',
  'repeat_interval_value',
  'max_sends',
  'escalation_after_iteration',
] as const;

const REMINDER_ONLY = [
  'initial_delay_value',
  'initial_delay_unit',
  'repeat_interval_value',
  'repeat_interval_unit',
  'max_sends',
  'timezone',
  'stop_condition_key',
  'escalation_audience_key',
  'escalation_after_iteration',
  'quiet_hours_enabled',
  'quiet_start',
  'quiet_end',
] as const;

/** Only what the administrator changed, so a save never rewrites what they did not touch. */
const changesOf = (before: Draft, now: Draft, reminder: boolean): NotificationRuleChanges => {
  const changes: Record<string, unknown> = {};

  const keys = (Object.keys(now) as (keyof Draft)[]).filter(
    (key) => key !== 'to' && key !== 'cc' && (reminder || !(REMINDER_ONLY as readonly string[]).includes(key))
  );

  for (const key of keys) {
    if (now[key] === before[key]) continue;

    if ((NUMBERS as readonly string[]).includes(key)) {
      changes[key] = now[key] === '' ? null : Number(now[key]);
    } else if (key === 'escalation_audience_key') {
      changes[key] = now[key] || null;
    } else {
      changes[key] = now[key];
    }
  }

  if (now.to !== before.to || now.cc !== before.cc) {
    changes.recipients = [
      ...splitCsv(now.to).map((email) => ({ email, kind: 'To' as const })),
      ...splitCsv(now.cc).map((email) => ({ email, kind: 'CC' as const })),
    ];
  }

  return changes as NotificationRuleChanges;
};

const badAddresses = (draft: Draft) =>
  [...splitCsv(draft.to), ...splitCsv(draft.cc)].filter((entry) => !EMAIL.test(entry));

const timezones = (): string[] => {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };

  try {
    return intl.supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
};

type EditorProps = {
  detail: NotificationRuleDetail;
  panel: PanelId;
  onPanel: (panel: PanelId) => void;
  onClose: () => void;
  onSaved: (message: string) => void;
  onReload: () => void;
  reloading: boolean;
};

const Section: React.FC<{ title: string; blurb?: string; children: React.ReactNode }> = ({
  title,
  blurb,
  children,
}) => (
  <section className="space-y-4 rounded-xl border border-slate-100 bg-white p-5">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {blurb && <p className="mt-1 text-sm text-slate-500">{blurb}</p>}
    </div>
    {children}
  </section>
);

const Duration: React.FC<{
  idBase: string;
  label: string;
  value: string;
  unit: string;
  units: string[];
  min: number;
  onValue: (value: string) => void;
  onUnit: (unit: string) => void;
}> = ({ idBase, label, value, unit, units, min, onValue, onUnit }) => (
  <Field label={label} htmlFor={`${idBase}-value`}>
    <div className="flex items-center gap-2">
      <input
        id={`${idBase}-value`}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        className={`${inputClass} w-24 shrink-0`}
      />
      <Select
        value={unit}
        onChange={onUnit}
        options={units.map((entry) => ({ value: entry, label: entry }))}
        className="min-w-[7rem] flex-1"
        searchable={false}
      />
    </div>
  </Field>
);

const RuleEditor: React.FC<EditorProps> = ({
  detail,
  panel,
  onPanel,
  onClose,
  onSaved,
  onReload,
  reloading,
}) => {
  const { rule, choices } = detail;
  const idBase = useId();
  const original = useMemo(() => draftOf(rule), [rule]);
  const [draft, setDraft] = useState<Draft>(original);
  const [testTo, setTestTo] = useState('');
  const save = useSaveNotificationRule();
  const test = useTestNotificationRule();

  const reminder = rule.kind === 'Reminder';
  const locked = Boolean(rule.protected || choices.protected);
  const units = choices.units?.length ? choices.units : ['Hours', 'Days', 'Weeks'];
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const changes = changesOf(original, draft, reminder);
  const dirty = Object.keys(changes).length > 0;
  const invalid = badAddresses(draft);
  const conflict = save.error instanceof FrappeError && save.error.code === 'VERSION_CONFLICT';
  const testValid = EMAIL.test(testTo.trim());

  const preview = useNotificationPreview(rule.rule_key, panel === 'preview');
  const eligibility = useNotificationEligibility(rule.rule_key, panel === 'activity' && reminder);

  const submit = () => {
    if (!dirty || invalid.length) return;

    save.mutate(
      {
        rule_key: rule.rule_key,
        expected_revision: Number(rule.revision ?? 0),
        changes,
      },
      { onSuccess: () => onSaved(`${draft.display_name || rule.display_name} saved.`) }
    );
  };

  const templates = [...new Set([draft.template_name, ...choices.templates].filter(Boolean))];
  const audiences = choices.audiences ?? [];
  const stops = choices.stop_conditions ?? [];
  const zoneList = useMemo(() => timezones(), []);
  const lockId = `${idBase}-lock`;

  return (
    <>
      <div role="tablist" aria-label="Notification panels" className="flex gap-1 border-b border-slate-100 px-5">
        {PANELS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`${idBase}-tab-${entry.id}`}
            aria-selected={panel === entry.id}
            aria-controls={`${idBase}-panel-${entry.id}`}
            onClick={() => onPanel(entry.id)}
            className={`-mb-px h-11 border-b-2 px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:bg-blue-50 ${
              panel === entry.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${idBase}-panel-${panel}`}
        aria-labelledby={`${idBase}-tab-${panel}`}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-5"
      >
        {panel === 'configuration' && (
          <>
            <Section title="Notification">
              <div className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Enabled</p>
                  <p id={lockId} className="mt-0.5 text-sm text-slate-500">
                    {locked
                      ? 'Protected: this email keeps people able to reach their own account, so it cannot be switched off.'
                      : draft.enabled
                        ? 'Sends whenever its trigger fires.'
                        : 'Switched off. Nothing is sent while it is off.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {locked && <Lock size={15} className="text-slate-400" aria-hidden />}
                  <Switch
                    label="Enabled"
                    checked={locked ? true : draft.enabled}
                    disabled={locked}
                    describedBy={lockId}
                    onChange={(next) => set({ enabled: next })}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor={`${idBase}-name`}>
                  <input
                    id={`${idBase}-name`}
                    value={draft.display_name}
                    onChange={(event) => set({ display_name: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Category" htmlFor={`${idBase}-category`}>
                  <input id={`${idBase}-category`} value={rule.category} readOnly disabled className={inputClass} />
                </Field>
                <Field label="Type" htmlFor={`${idBase}-type`}>
                  <input
                    id={`${idBase}-type`}
                    value={reminder ? 'Reminder' : 'Event email'}
                    readOnly
                    disabled
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Trigger"
                  htmlFor={`${idBase}-trigger`}
                  hint="Set by the application. It cannot be edited here."
                >
                  <input
                    id={`${idBase}-trigger`}
                    value={rule.trigger_label || rule.trigger_key}
                    readOnly
                    disabled
                    className={inputClass}
                  />
                </Field>
                <Field label="Email template">
                  <Select
                    label={undefined}
                    value={draft.template_name}
                    onChange={(value) => set({ template_name: value })}
                    options={templates.map((entry) => ({ value: entry, label: entry }))}
                    placeholder="Choose a template"
                    protect
                  />
                </Field>
                <Field label="Audience">
                  <Select
                    value={draft.audience_key}
                    onChange={(value) => set({ audience_key: value })}
                    options={audiences.map((entry) => ({ value: entry.key, label: entry.label }))}
                    placeholder="Choose an audience"
                    searchable={false}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Additional recipients"
                  htmlFor={`${idBase}-to`}
                  hint="Separate addresses with commas."
                >
                  <input
                    id={`${idBase}-to`}
                    type="text"
                    value={draft.to}
                    onChange={(event) => set({ to: event.target.value })}
                    placeholder="ops@example.com"
                    className={inputClass}
                  />
                </Field>
                <Field label="CC" htmlFor={`${idBase}-cc`} hint="Copied on every send.">
                  <input
                    id={`${idBase}-cc`}
                    type="text"
                    value={draft.cc}
                    onChange={(event) => set({ cc: event.target.value })}
                    placeholder="manager@example.com"
                    className={inputClass}
                  />
                </Field>
              </div>
              {invalid.length > 0 && (
                <p role="alert" className="text-sm text-red-700">
                  Not a valid email address: {invalid.join(', ')}
                </p>
              )}
            </Section>

            {reminder ? (
              <Section
                title="Reminder schedule"
                blurb="When a record first becomes eligible, how often it repeats and when reminders stop."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Duration
                    idBase={`${idBase}-first`}
                    label="First reminder after"
                    value={draft.initial_delay_value}
                    unit={draft.initial_delay_unit}
                    units={units}
                    min={0}
                    onValue={(value) => set({ initial_delay_value: value })}
                    onUnit={(unit) => set({ initial_delay_unit: unit })}
                  />
                  <Duration
                    idBase={`${idBase}-repeat`}
                    label="Repeat every"
                    value={draft.repeat_interval_value}
                    unit={draft.repeat_interval_unit}
                    units={units}
                    min={1}
                    onValue={(value) => set({ repeat_interval_value: value })}
                    onUnit={(unit) => set({ repeat_interval_unit: unit })}
                  />
                  <Field label="Maximum reminders" htmlFor={`${idBase}-max`}>
                    <input
                      id={`${idBase}-max`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      value={draft.max_sends}
                      onChange={(event) => set({ max_sends: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Timezone" htmlFor={`${idBase}-tz`}>
                    <input
                      id={`${idBase}-tz`}
                      list={`${idBase}-zones`}
                      value={draft.timezone}
                      onChange={(event) => set({ timezone: event.target.value })}
                      className={inputClass}
                    />
                    <datalist id={`${idBase}-zones`}>
                      {zoneList.map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Stop condition" className="sm:col-span-2">
                    <Select
                      value={draft.stop_condition_key}
                      onChange={(value) => set({ stop_condition_key: value })}
                      options={stops.map((entry) => ({ value: entry.key, label: entry.label }))}
                      placeholder="Choose when reminders stop"
                      searchable={false}
                      className="w-full"
                    />
                  </Field>
                  <Field label="Escalate to (optional)">
                    <Select
                      value={draft.escalation_audience_key}
                      onChange={(value) => set({ escalation_audience_key: value })}
                      options={[
                        { value: NONE, label: 'No escalation' },
                        ...audiences.map((entry) => ({ value: entry.key, label: entry.label })),
                      ]}
                      searchable={false}
                    />
                  </Field>
                  <Field label="Escalate after reminder number" htmlFor={`${idBase}-esc`}>
                    <input
                      id={`${idBase}-esc`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      disabled={!draft.escalation_audience_key}
                      value={draft.escalation_after_iteration}
                      onChange={(event) => set({ escalation_after_iteration: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Quiet hours</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Sends are held until the quiet period ends, not dropped.
                    </p>
                  </div>
                  <Switch
                    label="Quiet hours"
                    checked={draft.quiet_hours_enabled}
                    onChange={(next) => set({ quiet_hours_enabled: next })}
                  />
                </div>
                {draft.quiet_hours_enabled && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Quiet period starts" htmlFor={`${idBase}-qs`}>
                      <input
                        id={`${idBase}-qs`}
                        type="time"
                        value={draft.quiet_start}
                        onChange={(event) => set({ quiet_start: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Quiet period ends" htmlFor={`${idBase}-qe`}>
                      <input
                        id={`${idBase}-qe`}
                        type="time"
                        value={draft.quiet_end}
                        onChange={(event) => set({ quiet_end: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                )}

                <p className="rounded-lg bg-blue-50 px-3.5 py-3 text-sm text-blue-800">
                  Changing the schedule or switching the rule on starts from now. Records that were
                  already eligible are not sent the reminders they missed.
                </p>
              </Section>
            ) : (
              <p className="rounded-xl bg-blue-50 px-4 py-3.5 text-sm text-blue-800">
                <strong className="font-semibold">Event email.</strong> This message is sent when
                its event happens. It has no frequency, maximum or reminder schedule.
              </p>
            )}
          </>
        )}

        {panel === 'preview' && (
          <>
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This preview is rendered from the saved template and sends nothing.
            </p>
            {preview.isLoading ? (
              <SkeletonRows rows={3} />
            ) : preview.isError ? (
              <Message tone="error" title="The preview could not be rendered">
                {preview.error instanceof Error ? preview.error.message : 'Try again in a moment.'}
              </Message>
            ) : preview.data ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-3">
                  <p className="text-xs font-medium text-slate-500">Subject</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{preview.data.subject}</p>
                </div>
                <iframe
                  title="Rendered message"
                  sandbox=""
                  srcDoc={preview.data.message}
                  className="h-72 w-full bg-white"
                />
                {preview.data.context_note && (
                  <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                    {preview.data.context_note}
                  </p>
                )}
              </div>
            ) : null}

            <Section title="Send a test">
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                <FlaskConical size={16} className="mt-0.5 shrink-0" aria-hidden />
                <p>
                  A test is not a business reminder. It goes only to the address below, is marked as
                  a test in the delivery history, and does not count toward any record&apos;s
                  reminders.
                </p>
              </div>
              <Field label="Test recipient" htmlFor={`${idBase}-test`}>
                <input
                  id={`${idBase}-test`}
                  type="email"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div aria-live="polite" className="min-w-0 text-sm">
                  {test.isSuccess && (
                    <span className={test.data.status === 'Failed' ? 'text-red-700' : 'text-slate-600'}>
                      Test {String(test.data.status).toLowerCase()}
                      {test.data.reason ? `: ${test.data.reason}` : '.'}
                    </span>
                  )}
                  {test.isError && (
                    <span className="text-red-700">
                      {test.error instanceof Error ? test.error.message : 'The test could not be sent.'}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!testValid || test.isLoading}
                  title={testValid ? undefined : 'Enter a valid email address first'}
                  onClick={() => test.mutate({ rule_key: rule.rule_key, recipient: testTo.trim() })}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {test.isLoading ? 'Sending…' : 'Send test'}
                </button>
              </div>
            </Section>
          </>
        )}

        {panel === 'activity' && (
          <>
            <Section title="Recent activity" blurb="Changes and sends recorded for this notification.">
              {detail.audit.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing has been recorded for this notification yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {detail.audit.map((row) => (
                    <li key={row.name} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{row.action}</p>
                        <p className="text-xs text-slate-500">
                          {[row.actor, row.business_name, row.reason_code].filter(Boolean).join(' · ') || 'System'}
                        </p>
                        {row.detail && <p className="mt-0.5 break-words text-xs text-slate-500">{row.detail}</p>}
                      </div>
                      <span className="whitespace-nowrap text-xs tabular-nums text-slate-400">
                        {fmtMoment(row.creation)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="Records and their next reminder"
              blurb="For each record the rule watches: what is owed and why."
            >
              {!reminder ? (
                <p className="text-sm text-slate-500">An event email watches no records.</p>
              ) : eligibility.isLoading ? (
                <SkeletonRows rows={3} />
              ) : eligibility.isError ? (
                <Message tone="error" title="Eligibility could not be loaded">
                  {eligibility.error instanceof Error ? eligibility.error.message : 'Try again in a moment.'}
                </Message>
              ) : eligibility.data && eligibility.data.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500">
                        {['Record', 'Status', 'Reminder', 'Next due', 'Reason', 'Timezone', 'Revision'].map((head) => (
                          <th key={head} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {eligibility.data.rows.map((row, index) => (
                        <tr key={`${row.business_name ?? row.record}-${index}`}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
                            {row.business_name ?? row.record}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.status || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                            {row.iteration}
                            {row.max_sends ? ` of ${row.max_sends}` : ''}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                            {fmtMoment(row.next_due) ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.reason_label || row.reason}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500">{row.timezone || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">
                            {row.revision ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 pt-2 text-xs text-slate-400">
                    Showing {eligibility.data.rows.length} of {eligibility.data.total} records.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  {eligibility.data?.note || 'No records are being watched by this rule right now.'}
                </p>
              )}
            </Section>
          </>
        )}
      </div>

      <footer className="space-y-3 border-t border-slate-100 bg-white px-5 py-4">
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              This notification was changed by someone else while you were editing. Reload it, then
              apply your change again.
            </span>
            <button
              type="button"
              onClick={() => {
                save.reset();
                onReload();
              }}
              disabled={reloading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              <RefreshCw size={14} aria-hidden />
              Reload
            </button>
          </div>
        )}
        {save.isError && !conflict && (
          <p role="alert" className="text-sm text-red-700">
            {save.error instanceof Error ? save.error.message : 'The notification could not be saved.'}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!dirty || invalid.length > 0 || save.isLoading || conflict}
            className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isLoading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </footer>
    </>
  );
};

type DrawerProps = {
  ruleKey: string | null;
  fallbackName?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
};

const RuleDrawer: React.FC<DrawerProps> = ({ ruleKey, fallbackName, onClose, onSaved }) => {
  const detail = useNotificationRule(ruleKey);
  const [panel, setPanel] = useState<PanelId>('configuration');
  const shell = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!ruleKey) return;
    setPanel('configuration');
    const previous = document.activeElement as HTMLElement | null;
    shell.current?.focus();

    return () => previous?.focus?.();
  }, [ruleKey]);

  if (!ruleKey) return null;

  const data = detail.data;
  const rule = data?.rule;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      onMouseDown={onClose}
    >
      <div
        ref={shell}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-semibold text-slate-900">
              {rule?.display_name ?? fallbackName ?? 'Notification'}
            </h2>
            {rule && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{rule.category}</span>
                <Pill tone={rule.kind === 'Reminder' ? 'amber' : 'blue'}>
                  {rule.kind === 'Reminder' ? 'Reminder' : 'Event email'}
                </Pill>
                <Pill tone={healthTone(rule.health)}>{healthLabel(rule.health)}</Pill>
                {!rule.configured && <Pill>Not configured yet</Pill>}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </header>

        {detail.isLoading ? (
          <div className="flex-1"><SkeletonRows rows={6} /></div>
        ) : detail.isError || !data ? (
          <div className="flex-1">
            <Message
              tone="error"
              title="This notification could not be loaded"
              action={
                <button
                  type="button"
                  onClick={() => detail.refetch()}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Try again
                </button>
              }
            >
              {detail.error instanceof Error ? detail.error.message : undefined}
            </Message>
          </div>
        ) : (
          <RuleEditor
            key={`${data.rule.rule_key}:${data.rule.revision ?? 0}`}
            detail={data}
            panel={panel}
            onPanel={setPanel}
            onClose={onClose}
            onSaved={onSaved}
            onReload={() => detail.refetch()}
            reloading={detail.isFetching}
          />
        )}
      </div>
    </div>
  );
};

export default RuleDrawer;
