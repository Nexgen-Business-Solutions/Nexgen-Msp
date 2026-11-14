import type { NotificationHealth, NotificationRule } from '@/lib/api/internal';
import type { Tone } from './ui';

export const fmtMoment = (value?: string | null) =>
  value ? String(value).replace('T', ' ').slice(0, 16) : null;

export type NextDue = { text: string; muted: boolean };

/** What the table may say about the next send, and never a date the engine did not give. */
export const nextDueOf = (rule: Pick<NotificationRule, 'kind' | 'next_due' | 'next_due_label'>): NextDue => {
  if (rule.kind === 'Event') return { text: 'On next valid event', muted: true };
  if (rule.next_due_label) return { text: rule.next_due_label, muted: true };
  const moment = fmtMoment(rule.next_due);

  return moment ? { text: moment, muted: false } : { text: 'Not scheduled', muted: true };
};

export const frequencyOf = (rule: Pick<NotificationRule, 'kind' | 'frequency'>) =>
  rule.kind === 'Event' ? 'Event-triggered' : rule.frequency || 'Not configured';

/** Health is printed as the server states it: Unknown and No activity are never dressed up. */
export const healthTone = (health?: NotificationHealth | null): Tone => {
  switch (health?.state) {
    case 'Healthy':
      return 'green';
    case 'Failures':
      return 'red';
    case 'Unknown':
      return 'amber';
    default:
      return 'slate';
  }
};

export const healthLabel = (health?: NotificationHealth | null) => health?.state || 'Unknown';

export const healthDetail = (health?: NotificationHealth | null) => {
  if (!health) return undefined;
  const parts = [
    health.failed ? `${health.failed} failed` : '',
    health.unknown ? `${health.unknown} unknown` : '',
    health.queued ? `${health.queued} queued` : '',
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : undefined;
};

export const STATE_TONES: Record<string, Tone> = {
  Pending: 'amber',
  Queued: 'blue',
  Sent: 'green',
  Failed: 'red',
  Skipped: 'slate',
  Unknown: 'amber',
};

export const stateTone = (state: string): Tone => STATE_TONES[state] ?? 'slate';

/** What each delivery state actually proves, kept honest: Sent is not an inbox receipt. */
export const STATE_MEANING: Record<string, string> = {
  Pending: 'Waiting to be handed to the mail queue',
  Queued: 'Accepted into the Frappe email queue',
  Sent: 'Handed to the mail server; inbox delivery is not confirmed',
  Failed: 'The mail queue or server refused it',
  Skipped: 'Deliberately not sent',
  Unknown: 'The outcome could not be confirmed',
};

export const splitCsv = (value: string) =>
  value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

export type RuleFilters = { search: string; category: string; status: string; kind: string };

export const EMPTY_FILTERS: RuleFilters = { search: '', category: '', status: '', kind: '' };
