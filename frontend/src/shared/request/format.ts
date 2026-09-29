const parse = (value: string) => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (value: number) => String(value).padStart(2, '0');

export const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = parse(value);
  return date
    ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
    : String(value).slice(0, 10);
};

export const formatStamp = (value?: string | null) => {
  if (!value) return null;
  if (!String(value).includes(':')) return formatDate(value);
  const date = parse(value);
  if (!date) return String(value).slice(0, 16);
  return `${formatDate(value)} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export type BadgeTone = 'amber' | 'slate' | 'blue' | 'emerald' | 'red';

export const badgeClass = (tone: BadgeTone) =>
  `inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
    {
      amber: 'border-amber-200 bg-amber-50 text-amber-700',
      slate: 'border-slate-200 bg-white text-slate-600',
      blue: 'border-blue-200 bg-blue-50 text-blue-700',
      emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      red: 'border-red-200 bg-red-50 text-red-700',
    }[tone]
  }`;

export const toneOfBadge = (label: string): BadgeTone => {
  const value = label.toUpperCase();
  if (value.startsWith('RESOLVED') || value.startsWith('COMPLETED') || value === 'READY') return 'emerald';
  if (value.startsWith('CANCELLED') || value === 'EXISTING') return 'slate';
  return 'amber';
};

export const sectionClass = 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm';

export const sectionHeadClass =
  'flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3';

export const linkButtonClass =
  'whitespace-nowrap py-2.5 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-800 hover:underline';
