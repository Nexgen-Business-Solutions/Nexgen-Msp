import React, { useEffect, useMemo, useRef, useState } from 'react';
import { History, Mail, RotateCcw, Save, Send, Upload } from 'lucide-react';
import Modal from '@/shared/components/Modal';
import type {
  NotificationLocale,
  NotificationTemplateDetail,
  NotificationTemplateLocaleState,
  NotificationTemplateVariable,
} from '@/lib/api/internal';
import {
  useNotificationTemplate,
  useNotificationTemplatePreview,
  usePublishNotificationTemplate,
  useRestoreNotificationTemplate,
  useSaveNotificationTemplateDraft,
  useTestNotificationTemplate,
} from './useNotifications';
import { Field, Message, Pill, Segmented, SkeletonRows, inputClass } from './ui';
import { fmtMoment } from './format';

type PanelId = 'editor' | 'preview' | 'history';

type Draft = { subject: string; html: string; text: string };

const EMPTY: Draft = { subject: '', html: '', text: '' };

const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const KIND_HINT: Record<NotificationTemplateVariable['kind'], string> = {
  text: 'Plain value, escaped where it lands',
  html: 'Built by the application, inserted as it is',
  url: 'A web address, checked before it is used',
};

const draftOf = (state?: NotificationTemplateLocaleState): Draft =>
  state
    ? {
        subject: state.draft_subject ?? '',
        html: state.draft_html ?? '',
        text: state.draft_text ?? '',
      }
    : EMPTY;

const stateOf = (detail: NotificationTemplateDetail | undefined, locale: NotificationLocale) =>
  detail?.locales.find((entry) => entry.locale === locale);

const errorOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

const TemplateEditor: React.FC<{
  templateName: string;
  initialLocale: NotificationLocale;
  onClose: () => void;
}> = ({ templateName, initialLocale, onClose }) => {
  const [locale, setLocale] = useState<NotificationLocale>(initialLocale);
  const [panel, setPanel] = useState<PanelId>('editor');
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // one draft per language, so switching tabs never carries one wording into the other
  const [drafts, setDrafts] = useState<Partial<Record<NotificationLocale, Draft>>>({});
  const [touched, setTouched] = useState<Partial<Record<NotificationLocale, boolean>>>({});
  const lastFocused = useRef<'subject' | 'html' | 'text'>('html');
  const fields = useRef<Partial<Record<'subject' | 'html' | 'text', HTMLInputElement | HTMLTextAreaElement | null>>>(
    {}
  );

  const detail = useNotificationTemplate(templateName, locale);
  const saveDraft = useSaveNotificationTemplateDraft();
  const publish = usePublishNotificationTemplate();
  const restore = useRestoreNotificationTemplate();
  const test = useTestNotificationTemplate();

  const current = stateOf(detail.data, locale);
  const stored = useMemo(() => draftOf(current), [current]);
  const draft = drafts[locale] ?? stored;
  const dirty = Boolean(touched[locale]);
  const anyDirty = Object.values(touched).some(Boolean);
  const variables = detail.data?.variables ?? [];
  const locales = detail.data?.locales ?? [];
  const busy = saveDraft.isLoading || publish.isLoading || restore.isLoading;

  const preview = useNotificationTemplatePreview(
    templateName,
    locale,
    current?.has_unpublished_changes || !current?.configured ? 'draft' : 'published',
    panel === 'preview' && !dirty
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);

    return () => clearTimeout(timer);
  }, [toast]);

  const edit = (patch: Partial<Draft>) => {
    setDrafts((before) => ({ ...before, [locale]: { ...draft, ...patch } }));
    setTouched((before) => ({ ...before, [locale]: true }));
  };

  const settle = (next: NotificationTemplateDetail) => {
    const fresh = stateOf(next, locale);
    setDrafts((before) => ({ ...before, [locale]: draftOf(fresh) }));
    setTouched((before) => ({ ...before, [locale]: false }));
    setNote('');
  };

  /** Put a variable where the caret was, rather than at the end of whatever is longest. */
  const insert = (name: string) => {
    const target = lastFocused.current;
    const element = fields.current[target];
    const value = draft[target];
    const token = `{{ ${name} }}`;
    const at = element?.selectionStart ?? value.length;
    const to = element?.selectionEnd ?? at;

    edit({ [target]: `${value.slice(0, at)}${token}${value.slice(to)}` } as Partial<Draft>);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange?.(at + token.length, at + token.length);
    });
  };

  const onSaveDraft = () =>
    saveDraft.mutate(
      {
        template_name: templateName,
        locale,
        subject: draft.subject,
        html: draft.html,
        text: draft.text,
        draft_revision: current?.draft_revision ?? 0,
      },
      {
        onSuccess: (next) => {
          settle(next);
          setToast('Draft saved. Nothing being sent has changed.');
        },
      }
    );

  const onPublish = () =>
    publish.mutate(
      {
        template_name: templateName,
        locale,
        change_note: note || undefined,
        draft_revision: current?.draft_revision ?? 0,
      },
      {
        onSuccess: (next) => {
          settle(next);
          setToast(`Published. ${stateOf(next, locale)?.locale_label} now sends this wording.`);
        },
      }
    );

  const onRestore = (revision: number) =>
    restore.mutate(
      {
        template_name: templateName,
        locale,
        revision_number: revision,
        draft_revision: current?.draft_revision ?? 0,
      },
      {
        onSuccess: (next) => {
          settle(next);
          setPanel('editor');
          setToast(`Revision ${revision} is back in the editor. Publish it to send it.`);
        },
      }
    );

  const startFromCurrent = () => {
    const legacy = detail.data?.legacy;

    edit({
      subject: draft.subject || legacy?.subject || '',
      html: legacy?.html || '',
    });
    setToast('The original wording is in the editor. It is yours once you publish it.');
  };

  const failure =
    saveDraft.error ?? publish.error ?? restore.error ?? test.error ?? null;

  const close = () => {
    if (anyDirty && !confirmClose) {
      setConfirmClose(true);

      return;
    }

    onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title={templateName}
      subtitle={detail.data?.rule_label ?? 'Email template'}
      icon={Mail}
      widthClass="max-w-5xl"
    >
      {detail.isLoading ? (
        <SkeletonRows rows={6} />
      ) : detail.isError ? (
        <Message tone="error" title="This template could not be loaded">
          {errorOf(detail.error)}
        </Message>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Language"
              value={locale}
              onChange={(next) => setLocale(next as NotificationLocale)}
              options={locales.map((entry) => ({ value: entry.locale, label: entry.locale_label }))}
            />
            <div className="flex items-center gap-2">
              {current?.configured ? (
                <Pill tone="green">Revision {current.published_revision} published</Pill>
              ) : (
                <Pill tone="slate">Not configured</Pill>
              )}
              {dirty && <Pill tone="amber">Unsaved</Pill>}
              {!dirty && current?.has_unpublished_changes && <Pill tone="amber">Draft not published</Pill>}
            </div>
          </div>

          {!current?.configured && (
            <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Nothing is published in this language. Until something is, this notification goes out in{' '}
              {locales.find((entry) => entry.locale === detail.data?.fallback_locale)?.locale_label ??
                detail.data?.fallback_locale}{' '}
              where it is published, and otherwise in the original template.
              {current?.from_shipped && ' The wording below is that original: edit it and publish to take it over.'}
            </p>
          )}

          <div role="tablist" aria-label="Template panels" className="flex gap-1 border-b border-slate-100">
            {(
              [
                { id: 'editor' as PanelId, label: 'Editor' },
                { id: 'preview' as PanelId, label: 'Preview' },
                { id: 'history' as PanelId, label: 'Revision history' },
              ]
            ).map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`template-tab-${entry.id}`}
                aria-selected={panel === entry.id}
                aria-controls={`template-panel-${entry.id}`}
                onClick={() => setPanel(entry.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${
                  panel === entry.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {failure && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {errorOf(failure)}
            </p>
          )}

          {toast && (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{toast}</p>
          )}

          <div
            role="tabpanel"
            id={`template-panel-${panel}`}
            aria-labelledby={`template-tab-${panel}`}
            className="space-y-4"
          >
            {panel === 'editor' && (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="text-xs font-semibold text-slate-500">Variables</span>
                  {variables.map((variable) => (
                    <button
                      key={variable.name}
                      type="button"
                      onClick={() => insert(variable.name)}
                      title={KIND_HINT[variable.kind]}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                    >
                      {variable.name}
                    </button>
                  ))}
                </div>

                <Field label="Subject" htmlFor="template-subject">
                  <input
                    id="template-subject"
                    ref={(element) => {
                      fields.current.subject = element;
                    }}
                    value={draft.subject}
                    onFocus={() => {
                      lastFocused.current = 'subject';
                    }}
                    onChange={(event) => edit({ subject: event.target.value })}
                    className={inputClass}
                  />
                </Field>

                <Field
                  label="HTML body"
                  htmlFor="template-html"
                  hint="Scripts, event handlers and anything active are removed when this is saved."
                >
                  <textarea
                    id="template-html"
                    ref={(element) => {
                      fields.current.html = element;
                    }}
                    rows={12}
                    value={draft.html}
                    onFocus={() => {
                      lastFocused.current = 'html';
                    }}
                    onChange={(event) => edit({ html: event.target.value })}
                    className={textareaClass}
                  />
                </Field>

                <Field
                  label="Plain text body"
                  htmlFor="template-text"
                  hint="Optional. Kept with the revision and shown in the preview. The text part of the message itself is derived from the HTML by the mail queue."
                >
                  <textarea
                    id="template-text"
                    ref={(element) => {
                      fields.current.text = element;
                    }}
                    rows={5}
                    value={draft.text}
                    onFocus={() => {
                      lastFocused.current = 'text';
                    }}
                    onChange={(event) => edit({ text: event.target.value })}
                    className={textareaClass}
                  />
                </Field>

                <Field label="What changed" htmlFor="template-note" hint="Kept with the published revision.">
                  <input
                    id="template-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className={inputClass}
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={busy || !draft.html.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                  >
                    <Save size={15} aria-hidden />
                    Save draft
                  </button>
                  <button
                    type="button"
                    onClick={onPublish}
                    disabled={busy || dirty || !current?.has_unpublished_changes}
                    title={dirty ? 'Save the draft first.' : undefined}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                  >
                    <Upload size={15} aria-hidden />
                    Publish
                  </button>
                  {!draft.html.trim() && detail.data?.legacy.html && (
                    <button
                      type="button"
                      onClick={startFromCurrent}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                    >
                      Start from the current wording
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
                  <Field
                    label="Send a test to"
                    htmlFor="template-test"
                    className="flex-1 sm:max-w-xs"
                    hint="Your own address, or another administrator's."
                  >
                    <input
                      id="template-test"
                      type="email"
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() =>
                      test.mutate(
                        {
                          template_name: templateName,
                          locale,
                          recipient,
                          source: current?.has_unpublished_changes ? 'draft' : 'published',
                        },
                        { onSuccess: (out) => setToast(`Test ${out.status.toLowerCase()}.`) }
                      )
                    }
                    disabled={test.isLoading || !recipient.trim() || dirty}
                    title={dirty ? 'Save the draft first.' : undefined}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                  >
                    <Send size={15} aria-hidden />
                    Send test
                  </button>
                </div>
              </>
            )}

            {panel === 'preview' && (
              <>
                {dirty ? (
                  <Message
                    tone="empty"
                    title="There are unsaved changes"
                    action={
                      <button
                        type="button"
                        onClick={onSaveDraft}
                        disabled={busy || !draft.html.trim()}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                      >
                        <Save size={15} aria-hidden />
                        Save draft
                      </button>
                    }
                  >
                    A preview is rendered from the saved draft, so it would show the wording
                    before your edit. Save the draft and it will show what you wrote.
                  </Message>
                ) : preview.isLoading ? (
                  <SkeletonRows rows={4} />
                ) : preview.isError ? (
                  <Message tone="empty" title="There is nothing to preview in this language yet">
                    {errorOf(preview.error)}
                  </Message>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">{preview.data?.context_note}</p>
                    <Field label="Subject">
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                        {preview.data?.subject}
                      </p>
                    </Field>
                    <Field label="Message">
                      <iframe
                        title="Template preview"
                        sandbox=""
                        srcDoc={preview.data?.html ?? ''}
                        className="h-[26rem] w-full rounded-lg border border-slate-200 bg-white"
                      />
                    </Field>
                    {preview.data?.text && (
                      <Field label="Plain text">
                        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          {preview.data.text}
                        </pre>
                      </Field>
                    )}
                  </div>
                )}
              </>
            )}

            {panel === 'history' && (
              <>
                {(detail.data?.revisions ?? []).length === 0 ? (
                  <Message title="Nothing has been published in this language yet" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {(detail.data?.revisions ?? []).map((revision) => (
                      <li key={revision.name} className="flex flex-wrap items-start gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              Revision {revision.revision_number}
                            </p>
                            {revision.is_published && <Pill tone="green">Published</Pill>}
                          </div>
                          <p className="mt-0.5 text-sm text-slate-600">{revision.subject}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {fmtMoment(revision.creation)} · {revision.owner}
                            {revision.change_note ? ` · ${revision.change_note}` : ''}
                          </p>
                          {revision.variables_used && (
                            <p className="mt-0.5 font-mono text-xs text-slate-400">
                              {revision.variables_used}
                            </p>
                          )}
                        </div>
                        {!revision.is_published && (
                          <button
                            type="button"
                            onClick={() => onRestore(revision.revision_number)}
                            disabled={busy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                          >
                            <RotateCcw size={14} aria-hidden />
                            Restore
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  <History size={14} aria-hidden />
                  Restoring brings old wording back into the editor. It is sent once published, and the
                  revision it came from is left exactly as it was.
                </p>
              </>
            )}
          </div>

          {confirmClose && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
            >
              <span>There are unsaved changes. Close anyway?</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClose(false)}
                  className="h-9 rounded-lg border border-amber-200 bg-white px-3 font-semibold text-amber-800"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 rounded-lg bg-amber-600 px-3 font-semibold text-white"
                >
                  Discard
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default TemplateEditor;
