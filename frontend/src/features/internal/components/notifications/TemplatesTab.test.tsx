import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { FrappeError } from '@/lib/api/client';
import NotificationSettings from '../../pages/NotificationSettings';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getNotificationOverview: vi.fn(),
    getNotificationTemplates: vi.fn(),
    getNotificationTemplate: vi.fn(),
    saveNotificationTemplateDraft: vi.fn(),
    publishNotificationTemplate: vi.fn(),
    restoreNotificationTemplate: vi.fn(),
    previewNotificationTemplate: vi.fn(),
    testNotificationTemplate: vi.fn(),
  };
});

const LOCALES = [
  { key: 'en' as const, label: 'English' },
  { key: 'fr' as const, label: 'Français' },
];

const localeState = (
  overrides: Partial<internal.NotificationTemplateLocaleState> = {}
): internal.NotificationTemplateLocaleState => ({
  locale: 'en',
  locale_label: 'English',
  configured: false,
  draft_revision: 0,
  published_revision: null,
  draft_subject: null,
  draft_html: null,
  draft_text: null,
  last_edited_by: null,
  last_edited_at: null,
  has_unpublished_changes: false,
  ...overrides,
});

const ENGLISH = localeState({
  configured: true,
  published_revision: 2,
  draft_revision: 3,
  draft_subject: 'English subject',
  draft_html: '<p>English wording</p>',
  draft_text: 'English wording',
});

const FRENCH = localeState({ locale: 'fr', locale_label: 'Français' });

const row = (
  overrides: Partial<internal.NotificationTemplateRow> = {}
): internal.NotificationTemplateRow => ({
  template_name: 'MSP Request Received',
  rule_key: 'request_received',
  rule_label: 'Request received',
  category: 'Requests',
  kind: 'Event',
  protected: false,
  locales: [ENGLISH, FRENCH],
  last_edited_at: '2026-11-18 09:30:00',
  ...overrides,
});

const detail = (
  overrides: Partial<internal.NotificationTemplateDetail> = {}
): internal.NotificationTemplateDetail => ({
  template_name: 'MSP Request Received',
  rule_key: 'request_received',
  rule_label: 'Request received',
  locale: 'en',
  locales: [ENGLISH, FRENCH],
  variables: [
    { name: 'full_name', kind: 'text' },
    { name: 'summary', kind: 'html' },
    { name: 'link', kind: 'url' },
  ],
  published: {
    subject: 'English subject',
    html_body: '<p>English wording</p>',
    text_body: 'English wording',
    revision_number: 2,
  },
  legacy: { subject: 'Original subject', html: '<p>Original wording</p>' },
  fallback_locale: 'en',
  revisions: [
    {
      name: 'MSP Request Received::en::2',
      revision_number: 2,
      subject: 'English subject',
      html_body: '<p>English wording</p>',
      text_body: null,
      variables_used: 'full_name',
      change_note: 'second pass',
      content_checksum: 'bbb',
      owner: 'admin@example.invalid',
      creation: '2026-11-18 09:30:00',
      is_published: true,
    },
    {
      name: 'MSP Request Received::en::1',
      revision_number: 1,
      subject: 'First subject',
      html_body: '<p>First wording</p>',
      text_body: null,
      variables_used: 'full_name',
      change_note: 'first pass',
      content_checksum: 'aaa',
      owner: 'admin@example.invalid',
      creation: '2026-11-17 09:30:00',
      is_published: false,
    },
  ],
  ...overrides,
});

const mockPage = () =>
  vi.mocked(internal.getNotificationOverview).mockResolvedValue({
    figures: {
      managed: 1,
      enabled: 1,
      reminders: 0,
      pending: 0,
      queued: 0,
      sent: 0,
      failed: 0,
      unknown: 0,
    },
    rules: [],
    total: 0,
    page: 0,
    page_length: 50,
    filters: { categories: [], kinds: [] },
    can_create: [],
  });

const mockTemplates = (rows = [row()]) =>
  vi.mocked(internal.getNotificationTemplates).mockResolvedValue({
    rows,
    locales: LOCALES,
    fallback_locale: 'en',
  });

const mockDetail = () =>
  vi.mocked(internal.getNotificationTemplate).mockImplementation(async (_name, locale) =>
    detail({ locale })
  );

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <NotificationSettings />
    </QueryClientProvider>
  );
};

const openTemplates = async () => {
  fireEvent.click(await screen.findByRole('tab', { name: /^Templates$/ }));

  return screen.findByRole('table');
};

const openEditor = async () => {
  await openTemplates();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

  return screen.findByRole('dialog');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Email Management tabs', () => {
  it('offers every main tab, with the sources inventory still reachable', async () => {
    mockPage();
    renderPage();

    for (const name of [
      /Notification rules/,
      /^Templates$/,
      /Delivery history/,
      /Notification sources/,
    ]) {
      expect(await screen.findByRole('tab', { name })).toBeInTheDocument();
    }
  });
});

describe('the template list', () => {
  it('names the published revision of a configured language and leaves the other unconfigured', async () => {
    mockPage();
    mockTemplates();
    renderPage();

    const table = await openTemplates();
    expect(within(table).getByText('Revision 2')).toBeInTheDocument();
    expect(within(table).getByText('Not configured')).toBeInTheDocument();
    expect(within(table).getByText('Request received')).toBeInTheDocument();
  });

  it('shows a column for each language the server publishes', async () => {
    mockPage();
    mockTemplates();
    renderPage();

    const table = await openTemplates();
    expect(within(table).getByRole('columnheader', { name: 'English' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Français' })).toBeInTheDocument();
  });

  it('says so rather than showing an empty table when nothing matches', async () => {
    mockPage();
    mockTemplates();
    renderPage();

    await openTemplates();
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'zzzz' } });

    expect(await screen.findByText('No template matches that search')).toBeInTheDocument();
  });

  it('reports a failure to load instead of an empty list', async () => {
    mockPage();
    vi.mocked(internal.getNotificationTemplates).mockRejectedValue(
      new FrappeError('The templates are unavailable', 500)
    );
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /^Templates$/ }));

    expect(await screen.findByText('The templates could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The templates are unavailable')).toBeInTheDocument();
  });
});

describe('the template editor', () => {
  it('opens on the wording stored for the language and lists what it may name', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('English subject');
    expect(within(dialog).getByLabelText('HTML body')).toHaveValue('<p>English wording</p>');
    expect(within(dialog).getByRole('button', { name: 'full_name' })).toBeInTheDocument();
    expect(within(dialog).getByText('Revision 2 published')).toBeInTheDocument();
  });

  it('keeps each language its own draft when the selector is switched', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>my english edit</p>' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Français' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('HTML body')).toHaveValue('')
    );

    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>ma formulation</p>' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'English' }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText('HTML body')).toHaveValue('<p>my english edit</p>')
    );
  });

  it('tells an administrator what an unconfigured language falls back to', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Français' }));

    expect(await within(dialog).findByText(/Nothing is published in this language/)).toBeInTheDocument();
    expect(within(dialog).getByText(/original template/)).toBeInTheDocument();
  });

  it('inserts a variable into the field that was last focused', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    const subject = within(dialog).getByLabelText('Subject');
    fireEvent.focus(subject);
    fireEvent.click(within(dialog).getByRole('button', { name: 'full_name' }));

    await waitFor(() => expect(subject).toHaveValue('English subject{{ full_name }}'));
    expect(within(dialog).getByLabelText('HTML body')).toHaveValue('<p>English wording</p>');
  });

  it('saves a draft with the version it read, and says nothing has been sent', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.saveNotificationTemplateDraft).mockResolvedValue(detail());
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>edited</p>' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save draft/ }));

    await waitFor(() =>
      expect(internal.saveNotificationTemplateDraft).toHaveBeenCalledWith({
        template_name: 'MSP Request Received',
        locale: 'en',
        subject: 'English subject',
        html: '<p>edited</p>',
        text: 'English wording',
        draft_revision: 3,
      })
    );
    expect(await within(dialog).findByText(/Nothing being sent has changed/)).toBeInTheDocument();
  });

  it('refuses to publish an edit that has not been saved yet', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>edited</p>' },
    });

    expect(within(dialog).getByRole('button', { name: /Publish/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /Send test/ })).toBeDisabled();
  });

  it('shows the conflict the server reports rather than silently losing the edit', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.saveNotificationTemplateDraft).mockRejectedValue(
      new FrappeError('Somebody else has saved this template since you opened it.', 409)
    );
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>mine</p>' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save draft/ }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Somebody else has saved this template/
    );
    expect(within(dialog).getByLabelText('HTML body')).toHaveValue('<p>mine</p>');
  });

  it('asks before throwing an unsaved edit away', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>unsaved</p>' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(await within(dialog).findByText(/There are unsaved changes/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('HTML body')).toHaveValue('<p>unsaved</p>');
  });

  it('previews what the editor holds, and sends nothing to do it', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.previewNotificationTemplate).mockResolvedValue({
      subject: 'English subject SR-0000-00000',
      html: '<p>English wording for Sample Recipient</p>',
      text: 'English wording for Sample Recipient',
      locale: 'en',
      revision: 2,
      source: 'published',
      context_note: 'Rendered with sample values and sent to nobody.',
    });
    renderPage();

    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));

    expect(await within(dialog).findByText('English subject SR-0000-00000')).toBeInTheDocument();
    expect(within(dialog).getByText(/sent to nobody/)).toBeInTheDocument();
    expect(within(dialog).getByTitle('Template preview')).toHaveAttribute(
      'srcdoc',
      '<p>English wording for Sample Recipient</p>'
    );
    expect(internal.testNotificationTemplate).not.toHaveBeenCalled();
  });

  it('asks for the draft to be saved rather than previewing the wording before the edit', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.previewNotificationTemplate).mockResolvedValue({
      subject: 'English subject',
      html: '<p>the wording before the edit</p>',
      text: null,
      locale: 'en',
      revision: 2,
      source: 'published',
      context_note: 'Rendered with sample values and sent to nobody.',
    });
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>my edit</p>' },
    });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));

    expect(await within(dialog).findByText('There are unsaved changes')).toBeInTheDocument();
    expect(within(dialog).queryByText('the wording before the edit')).not.toBeInTheDocument();
    expect(internal.previewNotificationTemplate).not.toHaveBeenCalled();
  });

  it('previews once the draft is saved', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.saveNotificationTemplateDraft).mockResolvedValue(detail());
    vi.mocked(internal.previewNotificationTemplate).mockResolvedValue({
      subject: 'English subject',
      html: '<p>the saved wording</p>',
      text: null,
      locale: 'en',
      revision: 2,
      source: 'draft',
      context_note: 'Rendered with sample values and sent to nobody.',
    });
    renderPage();

    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText('HTML body'), {
      target: { value: '<p>my edit</p>' },
    });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Preview' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Save draft/ }));

    expect(await within(dialog).findByTitle('Template preview')).toHaveAttribute(
      'srcdoc',
      '<p>the saved wording</p>'
    );
  });

  it('says there is nothing to preview in a language nobody has written', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.previewNotificationTemplate).mockRejectedValue(
      new FrappeError('There is no draft in this language yet.', 404)
    );
    renderPage();

    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Français' }));
    fireEvent.click(await within(dialog).findByRole('tab', { name: 'Preview' }));

    expect(
      await within(dialog).findByText('There is nothing to preview in this language yet')
    ).toBeInTheDocument();
  });

  it('lists every revision, marks the published one and only offers to restore the others', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Revision history' }));

    expect(await within(dialog).findByText('Revision 2')).toBeInTheDocument();
    expect(within(dialog).getByText('Revision 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Published')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: /Restore/ })).toHaveLength(1);
  });

  it('restores an old revision into the editor rather than sending it', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    vi.mocked(internal.restoreNotificationTemplate).mockResolvedValue(detail());
    renderPage();

    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Revision history' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Restore/ }));

    await waitFor(() =>
      expect(internal.restoreNotificationTemplate).toHaveBeenCalledWith({
        template_name: 'MSP Request Received',
        locale: 'en',
        revision_number: 1,
        draft_revision: 3,
      })
    );
    expect(await within(dialog).findByText(/Publish it to send it/)).toBeInTheDocument();
  });

  it('will not send a test without an address to send it to', async () => {
    mockPage();
    mockTemplates();
    mockDetail();
    renderPage();

    const dialog = await openEditor();

    expect(within(dialog).getByRole('button', { name: /Send test/ })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Send a test to'), {
      target: { value: 'admin@example.invalid' },
    });

    expect(within(dialog).getByRole('button', { name: /Send test/ })).toBeEnabled();
  });
});
