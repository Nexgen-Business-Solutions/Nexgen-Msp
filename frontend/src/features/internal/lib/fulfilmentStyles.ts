import type { SubjectWorkGroup, WorkCard } from '@/lib/api/internal';

/** The few looks the fulfilment screens repeat, named once so every step reads the same. */

export const btn =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const btnPrimary =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300';

export const btnAccept =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

export const btnReject =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50/40 px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';

export const btnExtra =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 px-3 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50';

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

export const subjectCard = 'overflow-hidden rounded-xl border border-slate-200';

export const subjectHead =
  'flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3';

export const lineRow =
  'grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]';

export const banner = 'rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900';

export const nextBar =
  'flex flex-col items-stretch justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center';

export const warnBar = 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900';

export const bulkBar =
  'flex flex-col items-stretch justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3 sm:flex-row sm:items-center';

export const pill = (tone: 'ready' | 'pending' | 'blue' | 'violet' | 'emerald' | 'slate') =>
  `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
    {
      ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      pending: 'border-amber-200 bg-amber-50 text-amber-800',
      blue: 'border-blue-200 bg-blue-50 text-blue-700',
      violet: 'border-violet-200 bg-violet-50 text-violet-700',
      slate: 'border-slate-200 bg-slate-50 text-slate-600',
    }[tone]
  }`;

export const initials = (name?: string | null) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const fmtStamp = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 16)
    : date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

/** A service act that is issued against an account name or a serial the record does not have. */
/** What a service is issued against: the username on a personal one, the serial on a machine,
 * and both when it is sold to both and runs on a machine somebody holds. */
export const identifiersMissing = (card: WorkCard, person: SubjectWorkGroup['person']) => {
  const issuing = ['Add', 'Change'].includes(card.action);
  const onDevice = card.target_scope === 'Device';

  return {
    serial: issuing && onDevice && !card.device?.serial_number,
    username:
      issuing &&
      (!onDevice || (card.service_scope === 'Both' && Boolean(person?.name))) &&
      !person?.username,
  };
};

export const identifierMissing = (card: WorkCard, person: SubjectWorkGroup['person']) => {
  const needs = identifiersMissing(card, person);
  return needs.serial || needs.username;
};
