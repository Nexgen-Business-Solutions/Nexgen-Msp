import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as internal from '@/lib/api/internal';
import { FrappeError } from '@/lib/api/client';
import NotificationSettings from './NotificationSettings';

vi.mock('@/lib/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/internal')>();
  return {
    ...actual,
    getNotificationOverview: vi.fn(),
    getNotificationRule: vi.fn(),
    saveNotificationRule: vi.fn(),
    previewNotificationRule: vi.fn(),
    testNotificationRule: vi.fn(),
    getNotificationHistory: vi.fn(),
    getNotificationSources: vi.fn(),
    getNotificationEligibility: vi.fn(),
    getNotificationDispatchEvidence: vi.fn(),
    resolveNotificationDispatch: vi.fn(),
  };
});

const health = { state: 'Healthy', failed: 0, unknown: 0, queued: 0 };

const rule = (overrides: Partial<internal.NotificationRule> = {}): internal.NotificationRule => ({
  rule_key: 'request_approved',
  display_name: 'Request approved',
  category: 'Requests',
  kind: 'Event',
  enabled: true,
  protected: false,
  configured: true,
  trigger_key: 'MSP Request approved',
  trigger_label: 'A request is approved or declined',
  template_name: 'Request Approved',
  audience_key: 'requester',
  audience_label: 'Requester',
  cc: [],
  extra: [],
  frequency: 'Event-triggered',
  last_sent: null,
  next_due: null,
  next_due_label: 'On next valid event',
  eligible_count: null,
  max_sends: null,
  health,
  ...overrides,
});

const EVENT = rule();
const REMINDER = rule({
  rule_key: 'request_waiting',
  display_name: 'Request waiting for review',
  kind: 'Reminder',
  trigger_key: 'MSP Request submitted',
  frequency: 'After 2 days, then every 1 days',
  next_due: null,
  next_due_label: 'None eligible',
  max_sends: 3,
  health: { state: 'No activity', failed: 0, unknown: 0, queued: 0 },
});
const PROTECTED = rule({
  rule_key: 'password_reset',
  display_name: 'Password reset',
  category: 'Accounts',
  protected: true,
  health: { state: 'Unknown', failed: 0, unknown: 2, queued: 0 },
});
const ALL = [EVENT, REMINDER, PROTECTED];

const overviewOf = (
  rules: internal.NotificationRule[],
  can_create: string[] = ['invoice_due']
): internal.NotificationOverview => ({
  figures: { managed: 3, enabled: 3, reminders: 1, pending: 2, queued: 4, sent: 9, failed: 1, unknown: 2 },
  rules,
  total: rules.length,
  page: 0,
  page_length: 50,
  filters: { categories: ['Requests', 'Accounts'], kinds: ['Event', 'Reminder'] },
  can_create,
});

const detailOf = (
  base: internal.NotificationRule,
  extra: Partial<internal.NotificationRuleFields> = {}
): internal.NotificationRuleDetail => ({
  rule: {
    ...base,
    revision: 4,
    initial_delay_value: 2,
    initial_delay_unit: 'Days',
    repeat_interval_value: 1,
    repeat_interval_unit: 'Days',
    stop_condition_key: 'resolved',
    timezone: 'UTC',
    quiet_hours_enabled: 0,
    ...extra,
  },
  choices: {
    templates: ['Request Approved'],
    audiences: [{ key: 'requester', label: 'Requester' }],
    categories: ['Requests'],
    protected: base.protected,
    kind: base.kind,
    stop_conditions: [{ key: 'resolved', label: 'Stop when resolved' }],
    units: ['Hours', 'Days', 'Weeks'],
  },
  audit: [],
});

const mockOverview = (rules = ALL, can_create?: string[]) =>
  vi.mocked(internal.getNotificationOverview).mockImplementation(async (params = {}) => {
    const narrowed = rules.filter(
      (entry) =>
        (!params.kind || entry.kind === params.kind) &&
        (!params.category || entry.category === params.category) &&
        (!params.search || entry.display_name.toLowerCase().includes(params.search.toLowerCase())) &&
        (params.enabled !== 'protected' || entry.protected)
    );

    return overviewOf(narrowed, can_create);
  });

const mockDetails = () =>
  vi.mocked(internal.getNotificationRule).mockImplementation(async (key) => {
    const found = ALL.find((entry) => entry.rule_key === key) ?? EVENT;

    return detailOf(found);
  });

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

const range = (text: string) =>
  screen.getByText((_, node) => node?.tagName === 'P' && node.textContent === text);

const openRule = async (name: string) => {
  fireEvent.click(await screen.findByRole('row', { name: `Open ${name}` }));

  return screen.findByRole('dialog', { name: new RegExp(name, 'i') });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Email Management', () => {
  it('shows the counts the server returned and never invents a date for an event', async () => {
    mockOverview();
    renderPage();

    expect(await screen.findByText('Request approved')).toBeInTheDocument();
    expect(range('1–3 of 3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getAllByText('Event-triggered').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On next valid event').length).toBeGreaterThan(0);
    expect(screen.getByText('None eligible')).toBeInTheDocument();
  });

  it('prints Unknown and No activity as stated, never as healthy', async () => {
    mockOverview();
    renderPage();

    await screen.findByText('Request approved');
    const unknown = screen.getAllByText('Unknown').find((node) => node.tagName === 'SPAN');
    expect(unknown).toBeDefined();
    expect(screen.getByText('No activity')).toBeInTheDocument();
    expect(screen.getAllByText('Healthy')).toHaveLength(1);
  });

  it('narrows the list by search, by the Reminders segment and by protection', async () => {
    mockOverview();
    renderPage();
    await screen.findByText('Request approved');

    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));
    await waitFor(() => expect(screen.queryByText('Request approved')).not.toBeInTheDocument());
    expect(screen.getByText('Request waiting for review')).toBeInTheDocument();
    expect(range('1–1 of 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await screen.findByText('Request approved');

    fireEvent.change(screen.getByLabelText('Search notifications'), { target: { value: 'password' } });
    await waitFor(() => expect(screen.queryByText('Request approved')).not.toBeInTheDocument());
    expect(screen.getByText('Password reset')).toBeInTheDocument();
    expect(vi.mocked(internal.getNotificationOverview)).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'password' }),
      expect.anything()
    );
  });

  it('says so, and offers to clear, when nothing matches', async () => {
    mockOverview();
    renderPage();
    await screen.findByText('Request approved');

    fireEvent.change(screen.getByLabelText('Search notifications'), { target: { value: 'zzz' } });

    expect(await screen.findByText('No notification matches these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Request approved')).toBeInTheDocument();
  });

  it('shows an honest error with a retry when the overview cannot load', async () => {
    vi.mocked(internal.getNotificationOverview).mockRejectedValue(new Error('Server unavailable'));
    renderPage();

    expect(await screen.findByText('Notification settings could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('disables New rule, with the reason, when there is nothing left to create', async () => {
    mockOverview(ALL, []);
    renderPage();
    await screen.findByText('Request approved');

    const button = screen.getByRole('button', { name: 'New rule' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/already configured/i);
  });

  it('shows the reminder schedule only for a reminder', async () => {
    mockOverview();
    mockDetails();
    renderPage();

    const eventDrawer = await openRule('Request approved');
    expect(await within(eventDrawer).findByLabelText('Name')).toHaveValue('Request approved');
    expect(within(eventDrawer).queryByText('Reminder schedule')).not.toBeInTheDocument();
    expect(within(eventDrawer).queryByLabelText('Maximum reminders')).not.toBeInTheDocument();
    expect(within(eventDrawer).getByText(/no frequency, maximum or reminder schedule/i)).toBeInTheDocument();
    expect(within(eventDrawer).getByLabelText('Trigger')).toBeDisabled();
    fireEvent.click(within(eventDrawer).getByRole('button', { name: 'Close' }));

    const reminderDrawer = await openRule('Request waiting for review');
    expect(await within(reminderDrawer).findByText('Reminder schedule')).toBeInTheDocument();
    expect(within(reminderDrawer).getByLabelText('Maximum reminders')).toBeInTheDocument();
    expect(within(reminderDrawer).getByLabelText('First reminder after')).toHaveValue(2);
    expect(within(reminderDrawer).getByRole('switch', { name: 'Quiet hours' })).toBeInTheDocument();
  });

  it('blocks switching a protected rule off and says why', async () => {
    mockOverview();
    mockDetails();
    renderPage();

    const drawer = await openRule('Password reset');
    const toggle = await within(drawer).findByRole('switch', { name: 'Enabled' });

    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/cannot be switched off/i);
  });

  it('opens a row with Enter and closes the drawer with Escape', async () => {
    mockOverview();
    mockDetails();
    renderPage();

    const row = await screen.findByRole('row', { name: 'Open Request approved' });
    fireEvent.keyDown(row, { key: 'Enter' });

    const drawer = await screen.findByRole('dialog', { name: /request approved/i });
    fireEvent.keyDown(drawer, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves only what changed with the expected revision', async () => {
    mockOverview();
    mockDetails();
    vi.mocked(internal.saveNotificationRule).mockResolvedValue(detailOf(EVENT, { display_name: 'Approved' }));
    renderPage();

    const drawer = await openRule('Request approved');
    const save = within(drawer).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.change(await within(drawer).findByLabelText('Name'), { target: { value: 'Approved' } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(internal.saveNotificationRule).toHaveBeenCalledWith({
        rule_key: 'request_approved',
        expected_revision: 4,
        changes: { display_name: 'Approved' },
      })
    );
    expect(await screen.findByText('Approved saved.')).toBeInTheDocument();
  });

  it('tells the administrator when somebody else changed the rule, without retrying', async () => {
    mockOverview();
    mockDetails();
    vi.mocked(internal.saveNotificationRule).mockRejectedValue(
      new FrappeError('moved', 417, 'VERSION_CONFLICT')
    );
    renderPage();

    const drawer = await openRule('Request approved');
    fireEvent.change(await within(drawer).findByLabelText('Name'), { target: { value: 'Other' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));

    expect(await within(drawer).findByText(/changed by someone else/i)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(internal.saveNotificationRule).toHaveBeenCalledTimes(1);
  });

  it('labels a test send as a test, not a business reminder', async () => {
    mockOverview();
    mockDetails();
    vi.mocked(internal.previewNotificationRule).mockResolvedValue({
      subject: 'Your request was approved',
      message: '<p>Hello</p>',
    });
    vi.mocked(internal.testNotificationRule).mockResolvedValue({ status: 'Queued' });
    renderPage();

    const drawer = await openRule('Request approved');
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Preview' }));

    expect(await within(drawer).findByText('Your request was approved')).toBeInTheDocument();
    expect(within(drawer).getByText(/A test is not a business reminder/i)).toBeInTheDocument();

    const send = within(drawer).getByRole('button', { name: 'Send test' });
    expect(send).toBeDisabled();
    fireEvent.change(within(drawer).getByLabelText('Test recipient'), { target: { value: 'me@example.com' } });
    fireEvent.click(send);

    await waitFor(() =>
      expect(internal.testNotificationRule).toHaveBeenCalledWith({
        rule_key: 'request_approved',
        recipient: 'me@example.com',
      })
    );
  });

  it('lists the delivery states without claiming Sent means delivered', async () => {
    mockOverview();
    vi.mocked(internal.getNotificationHistory).mockResolvedValue({
      rows: ['Queued', 'Sent', 'Failed', 'Skipped'].map((status, index) => ({
        name: `D-${index}`,
        creation: '2026-11-01 10:00:00',
        rule: 'request_approved',
        business_doctype: 'MSP Request',
        business_name: `REQ-${index}`,
        recipient: 'a@example.com',
        template_name: 'Request Approved',
        subject_snapshot: 'Approved',
        attempt: 1,
        status,
        email_queue_id: status === 'Queued' ? 'EQ-9' : null,
        failure_reason: status === 'Failed' ? 'SMTP refused' : null,
        skip_reason: status === 'Skipped' ? 'Notification disabled' : null,
      })),
      total: 4,
      page: 0,
      page_length: 50,
      statuses: ['Queued', 'Sent', 'Failed', 'Skipped'],
    });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Delivery history' }));

    expect(await screen.findByText(/does not prove it reached an inbox/i)).toBeInTheDocument();
    const table = screen.getByRole('table');
    for (const label of ['Queued', 'Sent', 'Failed', 'Skipped']) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
    expect(within(table).getByText('SMTP refused')).toBeInTheDocument();
    expect(within(table).getByText('Queue EQ-9')).toBeInTheDocument();
    expect(within(table).getByText('Sent')).toHaveAttribute(
      'title',
      expect.stringContaining('not confirmed')
    );
  });

  it('never offers an action on an external source', async () => {
    mockOverview();
    vi.mocked(internal.getNotificationSources).mockResolvedValue({
      rows: [
        { source: 'Request approved', provider: 'Nexgen MSP', trigger_mode: 'Event', management: 'MSP-managed', notes: null },
        { source: 'Password reset', provider: 'Frappe', trigger_mode: 'Event', management: 'External / read-only', notes: 'Owned by Frappe' },
      ],
    });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Notification sources' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('External / read-only')).toBeInTheDocument();
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(within(table).queryAllByRole('switch')).toHaveLength(0);
  });

  describe('KPI eyes', () => {
    const historyOf = (rows = 0, total = 0): internal.NotificationHistory => ({
      rows: Array.from({ length: rows }, (_, index) => ({
        name: `D-${index}`,
        creation: '2026-11-01 10:00:00',
        rule: 'request_approved',
        business_doctype: 'MSP Request',
        business_name: `REQ-${index}`,
        recipient: 'a@example.com',
        template_name: 'Request Approved',
        subject_snapshot: 'Approved',
        attempt: 1,
        status: 'Failed',
        email_queue_id: null,
        failure_reason: null,
        skip_reason: null,
      })),
      total,
      page: 0,
      page_length: 50,
      statuses: ['Pending', 'Queued', 'Sent', 'Failed', 'Skipped', 'Unknown'],
    });

    it.each([
      ['Show enabled notification rules', { enabled: 'enabled' }],
      ['Show reminder rules', { kind: 'Reminder' }],
    ])('%s applies its rule filter', async (label, expected) => {
      mockOverview();
      vi.mocked(internal.getNotificationHistory).mockResolvedValue(historyOf());
      renderPage();
      await screen.findByText('Request approved');
      fireEvent.click(screen.getByRole('tab', { name: 'Delivery history' }));
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(screen.getByRole('tab', { name: /Notification rules/ })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationOverview)).toHaveBeenLastCalledWith(
          expect.objectContaining(expected),
          expect.anything()
        )
      );
    });

    it('Managed clears the rule filters', async () => {
      mockOverview();
      renderPage();
      await screen.findByText('Request approved');
      fireEvent.change(screen.getByLabelText('Search notifications'), { target: { value: 'password' } });
      await waitFor(() => expect(screen.queryByText('Request approved')).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Show all notification rules' }));

      expect(screen.getByLabelText('Search notifications')).toHaveValue('');
      expect(await screen.findByText('Request approved')).toBeInTheDocument();
    });

    it.each([
      ['Show queued deliveries', 'Queued'],
      ['Show failed deliveries', 'Failed'],
      ['Show deliveries with an unknown outcome', 'Unknown'],
    ])('%s opens the history filtered to %s', async (label, status) => {
      mockOverview();
      vi.mocked(internal.getNotificationHistory).mockResolvedValue(historyOf(1, 1));
      renderPage();
      await screen.findByText('Request approved');

      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(screen.getByRole('tab', { name: 'Delivery history' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationHistory)).toHaveBeenLastCalledWith(
          expect.objectContaining({ status, page: 0 }),
          expect.anything()
        )
      );
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });
  });

  describe('paging', () => {
    const many = (total: number): void => {
      vi.mocked(internal.getNotificationOverview).mockImplementation(async (params = {}) => ({
        ...overviewOf([EVENT]),
        total,
        page: params.page ?? 0,
        page_length: 1,
      }));
    };

    it('asks the API for the next page and is disabled at both ends', async () => {
      many(2);
      renderPage();
      await screen.findByText('Request approved');

      const previous = screen.getByRole('button', { name: 'Previous page' });
      const next = screen.getByRole('button', { name: 'Next page' });
      expect(previous).toBeDisabled();
      expect(next).toBeEnabled();

      fireEvent.click(next);
      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationOverview)).toHaveBeenLastCalledWith(
          expect.objectContaining({ page: 1, page_length: 50 }),
          expect.anything()
        )
      );
      await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    });

    it('goes back to the first page when a filter changes', async () => {
      many(3);
      renderPage();
      await screen.findByText('Request approved');
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationOverview)).toHaveBeenLastCalledWith(
          expect.objectContaining({ page: 1 }),
          expect.anything()
        )
      );

      fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));

      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationOverview)).toHaveBeenLastCalledWith(
          expect.objectContaining({ page: 0, kind: 'Reminder' }),
          expect.anything()
        )
      );
    });

    it('pages the delivery history through the API and resets on a filter change', async () => {
      mockOverview();
      vi.mocked(internal.getNotificationHistory).mockImplementation(async (params = {}) => ({
        rows: [],
        total: 120,
        page: params.page ?? 0,
        page_length: 50,
        statuses: ['Queued', 'Failed'],
      }));
      renderPage();
      fireEvent.click(await screen.findByRole('tab', { name: 'Delivery history' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationHistory)).toHaveBeenLastCalledWith(
          expect.objectContaining({ page: 1, page_length: 50 }),
          expect.anything()
        )
      );

      fireEvent.change(screen.getByLabelText('Search delivery history'), { target: { value: 'abc' } });
      await waitFor(() =>
        expect(vi.mocked(internal.getNotificationHistory)).toHaveBeenLastCalledWith(
          expect.objectContaining({ page: 0, search: 'abc' }),
          expect.anything()
        )
      );
    });
  });

  describe('settling a stuck delivery', () => {
    const stuckRows = ['Unknown', 'Failed', 'Sent', 'Queued'].map((status) => ({
      name: `D-${status}`,
      creation: '2026-11-01 10:00:00',
      rule: 'request_approved',
      business_doctype: 'MSP Request',
      business_name: `REQ-${status}`,
      recipient: 'a@example.com',
      template_name: 'Request Approved',
      subject_snapshot: 'Approved',
      attempt: 1,
      status,
      email_queue_id: null,
      failure_reason: null,
      skip_reason: null,
    }));

    const evidence: internal.NotificationDispatchEvidence = {
      dispatch: {
        name: 'D-Unknown',
        rule: 'request_approved',
        status: 'Unknown',
        recipient: 'a@example.com',
        business_doctype: 'MSP Request',
        business_name: 'REQ-Unknown',
        reminder_iteration: 1,
        subject_snapshot: 'Approved',
        reserved_at: '2026-11-01 10:00:00',
        failure_reason: 'Worker stopped',
      },
      candidates: [
        {
          email_queue: 'EQ-1',
          status: 'Sent',
          created: '2026-11-01 10:01:00',
          reference: 'MSP Request',
          matched: true,
        },
        {
          email_queue: 'EQ-2',
          status: 'Error',
          created: '2026-11-01 10:02:00',
          reference: 'MSP Request',
          matched: false,
        },
      ],
      decisions: ['link', 'not_sent'],
    };

    const openPanel = async () => {
      mockOverview();
      vi.mocked(internal.getNotificationHistory).mockResolvedValue({
        rows: stuckRows,
        total: 4,
        page: 0,
        page_length: 50,
        statuses: ['Unknown', 'Failed', 'Sent', 'Queued'],
      });
      vi.mocked(internal.getNotificationDispatchEvidence).mockResolvedValue(evidence);
      renderPage();
      fireEvent.click(await screen.findByRole('tab', { name: 'Delivery history' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Investigate D-Unknown' }));
      return screen.findByRole('dialog');
    };

    it('offers Investigate only on Unknown and Failed rows', async () => {
      mockOverview();
      vi.mocked(internal.getNotificationHistory).mockResolvedValue({
        rows: stuckRows,
        total: 4,
        page: 0,
        page_length: 50,
        statuses: [],
      });
      renderPage();
      fireEvent.click(await screen.findByRole('tab', { name: 'Delivery history' }));

      await screen.findByRole('button', { name: 'Investigate D-Unknown' });
      expect(screen.getByRole('button', { name: 'Investigate D-Failed' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Investigate D-Sent' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Investigate D-Queued' })).not.toBeInTheDocument();
    });

    it('lists the candidate queue entries and keeps attach disabled until one is picked', async () => {
      const dialog = await openPanel();

      expect(await within(dialog).findByText('EQ-1')).toBeInTheDocument();
      expect(within(dialog).getByText('EQ-2')).toBeInTheDocument();
      expect(within(dialog).getByText('Worker stopped')).toBeInTheDocument();
      const attach = within(dialog).getByRole('button', { name: 'Attach this queue entry' });
      expect(attach).toBeDisabled();

      fireEvent.click(within(dialog).getByLabelText('Select EQ-2'));
      expect(attach).toBeEnabled();
    });

    it('refuses a decision without a note and does not call the server', async () => {
      const dialog = await openPanel();
      await within(dialog).findByText('EQ-1');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Nothing was sent' }));

      expect(await within(dialog).findByText(/Write a note/)).toBeInTheDocument();
      expect(screen.queryByText('Record that nothing was sent?')).not.toBeInTheDocument();
      expect(internal.resolveNotificationDispatch).not.toHaveBeenCalled();
    });

    it('records not sent with the note after confirmation and says the scheduler will raise a reminder again', async () => {
      vi.mocked(internal.resolveNotificationDispatch).mockResolvedValue({ status: 'Failed', retry: 'scheduled' });
      const dialog = await openPanel();
      await within(dialog).findByText('EQ-1');

      fireEvent.change(within(dialog).getByLabelText('Note (required)'), { target: { value: 'Checked the mail log' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Nothing was sent' }));
      expect(internal.resolveNotificationDispatch).not.toHaveBeenCalled();
      expect(await screen.findByText(/makes the delivery owed again/)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Record that nothing was sent' }));

      await waitFor(() =>
        expect(internal.resolveNotificationDispatch).toHaveBeenCalledWith({
          dispatch: 'D-Unknown',
          decision: 'not_sent',
          note: 'Checked the mail log',
        })
      );
      expect(await screen.findByText('The reminder scheduler will raise this delivery again.')).toBeInTheDocument();
    });

    it('says nothing will resend an event notification on its own', async () => {
      vi.mocked(internal.resolveNotificationDispatch).mockResolvedValue({ status: 'Failed', retry: 'manual' });
      const dialog = await openPanel();
      await within(dialog).findByText('EQ-1');

      fireEvent.change(within(dialog).getByLabelText('Note (required)'), { target: { value: 'Checked the mail log' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Nothing was sent' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Record that nothing was sent' }));

      expect(
        await screen.findByText('Nothing will resend this on its own — repeat the action that sends it.')
      ).toBeInTheDocument();
    });

    const pickAndWriteNote = async (dialog: HTMLElement) => {
      await within(dialog).findByText('EQ-1');
      fireEvent.click(within(dialog).getByLabelText('Select EQ-2'));
      fireEvent.change(within(dialog).getByLabelText('Note (required)'), { target: { value: 'Matches the reference' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Attach this queue entry' }));
    };

    it('asks for confirmation before attaching and sends nothing until it is accepted', async () => {
      const dialog = await openPanel();
      await pickAndWriteNote(dialog);

      expect(await screen.findByText('Attach this queue entry?')).toBeInTheDocument();
      expect(internal.resolveNotificationDispatch).not.toHaveBeenCalled();
    });

    it('refuses to attach without a note and does not open the confirmation', async () => {
      const dialog = await openPanel();
      await within(dialog).findByText('EQ-1');
      fireEvent.click(within(dialog).getByLabelText('Select EQ-1'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Attach this queue entry' }));

      expect(await within(dialog).findByText(/Write a note/)).toBeInTheDocument();
      expect(screen.queryByText('Attach this queue entry?')).not.toBeInTheDocument();
      expect(internal.resolveNotificationDispatch).not.toHaveBeenCalled();
    });

    it('names the delivery, the chosen queue entry and the note in the attach confirmation', async () => {
      const dialog = await openPanel();
      await pickAndWriteNote(dialog);

      const confirm = (await screen.findByText('Attach this queue entry?')).closest('[role="dialog"]') as HTMLElement;
      expect(within(confirm).getByText(/request_approved to a@example\.com/)).toBeInTheDocument();
      expect(within(confirm).getByText('EQ-2 · Error · MSP Request')).toBeInTheDocument();
      expect(within(confirm).getByText('Matches the reference')).toBeInTheDocument();
      expect(within(confirm).getByText(/recorded under your name/)).toBeInTheDocument();
    });

    it('keeps the selection and the note when the attach confirmation is cancelled', async () => {
      const dialog = await openPanel();
      await pickAndWriteNote(dialog);

      const confirm = (await screen.findByText('Attach this queue entry?')).closest('[role="dialog"]') as HTMLElement;
      fireEvent.click(within(confirm).getAllByRole('button', { name: 'Cancel' })[1]);

      await waitFor(() => expect(screen.queryByText('Attach this queue entry?')).not.toBeInTheDocument());
      expect(within(dialog).getByLabelText('Select EQ-2')).toBeChecked();
      expect(within(dialog).getByLabelText('Note (required)')).toHaveValue('Matches the reference');
      expect(internal.resolveNotificationDispatch).not.toHaveBeenCalled();
    });

    it('attaches the chosen entry once with the note when the confirmation is accepted', async () => {
      vi.mocked(internal.resolveNotificationDispatch).mockResolvedValue({ status: 'Sent', retry: null });
      const dialog = await openPanel();
      await pickAndWriteNote(dialog);

      const confirm = (await screen.findByText('Attach this queue entry?')).closest('[role="dialog"]') as HTMLElement;
      fireEvent.click(within(confirm).getByRole('button', { name: 'Attach this queue entry' }));

      await waitFor(() => expect(internal.resolveNotificationDispatch).toHaveBeenCalledTimes(1));
      expect(internal.resolveNotificationDispatch).toHaveBeenCalledWith({
        dispatch: 'D-Unknown',
        decision: 'link',
        note: 'Matches the reference',
        email_queue: 'EQ-2',
      });
    });

    it('keeps the panel open and shows the server message when attaching is refused', async () => {
      vi.mocked(internal.resolveNotificationDispatch).mockRejectedValue(
        new FrappeError('That queue entry is already attached.', 417)
      );
      const dialog = await openPanel();
      await within(dialog).findByText('EQ-1');

      fireEvent.click(within(dialog).getByLabelText('Select EQ-1'));
      fireEvent.change(within(dialog).getByLabelText('Note (required)'), { target: { value: 'Matches the reference' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Attach this queue entry' }));
      const confirm = (await screen.findByText('Attach this queue entry?')).closest('[role="dialog"]') as HTMLElement;
      fireEvent.click(within(confirm).getByRole('button', { name: 'Attach this queue entry' }));

      expect(await screen.findByText('That queue entry is already attached.')).toBeInTheDocument();
      expect(screen.getByText('Investigate delivery')).toBeInTheDocument();
      expect(internal.resolveNotificationDispatch).toHaveBeenCalledWith({
        dispatch: 'D-Unknown',
        decision: 'link',
        note: 'Matches the reference',
        email_queue: 'EQ-1',
      });
    });
  });
});
