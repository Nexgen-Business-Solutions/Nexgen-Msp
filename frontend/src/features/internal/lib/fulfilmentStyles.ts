/** The few looks the fulfilment screens repeat, named once so every step reads the same. */

export const btnPrimary =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-blue-500 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300';

export const btnAccept =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-blue-50 px-3.5 py-2.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50';

export const btnReject =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

export const banner = 'rounded-xl bg-blue-50/60 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-100';

export const warnBar = 'rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200';

export const pill = (tone: 'ready' | 'pending' | 'blue' | 'violet' | 'emerald' | 'slate') =>
  `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
    {
      ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      pending: 'bg-amber-50 text-amber-800 ring-amber-200',
      blue: 'bg-blue-50 text-blue-700 ring-blue-200',
      violet: 'bg-violet-50 text-violet-700 ring-violet-200',
      slate: 'bg-slate-50 text-slate-600 ring-slate-200',
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
