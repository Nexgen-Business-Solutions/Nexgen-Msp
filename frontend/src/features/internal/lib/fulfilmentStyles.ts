/** The few looks the fulfilment screens repeat, named once so every step reads the same. */

export const btnPrimary =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300';

export const btnAccept =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50';

export const btnReject =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

export const banner = 'rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900';

export const warnBar = 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900';

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
