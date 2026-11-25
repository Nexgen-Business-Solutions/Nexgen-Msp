import React from 'react';
import { CircleCheck, Inbox, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

/**
 * The Billing module's own vocabulary, drawn in the internal dashboard's design.
 *
 * Every Billing screen is built from these pieces, so a card, a pill or a table reads the
 * same on the landing page, on a run and on an invoice.
 */

export const TONES = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-200/70',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  red: 'bg-red-50 text-red-700 ring-red-200/70',
  gray: 'bg-slate-50 text-slate-600 ring-slate-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200/70',
} as const;

export type Tone = keyof typeof TONES;

/** The soft icon tile a stat or an alert carries, in the same tints as the pills. */
const TILES: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  green: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  red: 'bg-red-50 text-red-600 ring-red-100',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
  purple: 'bg-violet-50 text-violet-600 ring-violet-100',
};

export const Pill: React.FC<{ tone?: Tone; title?: string; children: React.ReactNode }> = ({
  tone = 'gray',
  title,
  children,
}) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
  >
    {children}
  </span>
);

/** A small number beside a title: how many rows the panel holds. */
export const CountChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
    {children}
  </span>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <section
    className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 ${className}`}
  >
    {children}
  </section>
);

export const CardHead: React.FC<{
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  count?: React.ReactNode;
}> = ({ title, hint, right, count }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {count !== undefined && <CountChip>{count}</CountChip>}
      </div>
      {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
    </div>
    {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
  </div>
);

export const Foot: React.FC<{ left?: React.ReactNode; right?: React.ReactNode }> = ({
  left,
  right,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-sm text-slate-500">
    <span>{left}</span>
    <span className="tabular-nums">{right}</span>
  </div>
);

/** The facts under a title: what this document is, without opening anything. */
export const ContextBar: React.FC<{ facts: { label: string; value: React.ReactNode }[] }> = ({
  facts,
}) => (
  <div className="grid grid-cols-1 gap-3 px-5 pb-5 min-[420px]:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
    {facts.map((fact) => (
      <div
        key={fact.label}
        className="min-w-0 rounded-xl bg-slate-50/70 px-3.5 py-2.5 ring-1 ring-slate-200/60"
      >
        <span className="block text-xs text-slate-500">{fact.label}</span>{' '}
        <b className="block truncate text-sm font-medium text-slate-800">{fact.value}</b>
      </div>
    ))}
  </div>
);

const BANNER_LOOK = {
  amber: { box: 'bg-amber-50 text-amber-900 ring-amber-200', tile: TILES.amber, icon: TriangleAlert },
  blue: { box: 'bg-blue-50 text-blue-900 ring-blue-200/70', tile: TILES.blue, icon: Info },
  green: {
    box: 'bg-emerald-50 text-emerald-900 ring-emerald-200/70',
    tile: TILES.green,
    icon: CircleCheck,
  },
} as const;

export const Banner: React.FC<{
  tone?: 'amber' | 'blue' | 'green';
  title?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ tone = 'amber', title, children }) => {
  const look = BANNER_LOOK[tone];
  const Icon = look.icon;

  return (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm ring-1 ${look.box}`}>
      <span
        aria-hidden
        className={`grid size-8 shrink-0 place-items-center rounded-lg bg-white/70 ring-1 ${look.tile}`}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 self-center">
        {title && <strong className="font-semibold">{title}</strong>}{' '}
        <span>{children}</span>
      </div>
    </div>
  );
};

/** A stat tile in the dashboard's shape: icon tile, label, the figure, a quiet note. */
export const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** raised: the figure is something to act on, and is drawn in amber */
  raised?: boolean;
}> = ({ label, value, hint, icon: Icon, tone = 'blue', raised = false }) => (
  <div
    className={`flex h-full min-w-0 flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ${
      raised ? 'ring-amber-200' : 'ring-slate-200/70'
    }`}
  >
    <div className="flex items-start gap-3">
      {Icon && (
        <span
          aria-hidden
          className={`grid size-10 shrink-0 place-items-center rounded-xl ring-1 ${
            raised ? TILES.amber : TILES[tone]
          }`}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-slate-600">{label}</p>
        <p
          className={`truncate text-xl font-bold leading-tight tabular-nums sm:text-2xl ${
            raised ? 'text-amber-700' : 'text-slate-900'
          }`}
          title={String(value)}
        >
          {value}
        </p>
      </div>
    </div>
    {hint && (
      <p className={`mt-3 truncate text-[13px] ${raised ? 'text-amber-700' : 'text-slate-400'}`}>
        {hint}
      </p>
    )}
  </div>
);

export const InfoPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <aside className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">{children}</aside>
);

export const PanelTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-3 text-sm font-semibold text-slate-900">{children}</h3>
);

/** Label on the left, value on the right: the shape every side panel repeats. */
export const Summary: React.FC<{ rows: { label: string; value: React.ReactNode }[] }> = ({
  rows,
}) => (
  <dl className="space-y-2.5">
    {rows.map((row) => (
      <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
        <dt className="shrink-0 text-slate-500">{row.label}</dt>
        <dd className="min-w-0 truncate text-right font-medium tabular-nums text-slate-800">
          {row.value}
        </dd>
      </div>
    ))}
  </dl>
);

export const Divider: React.FC = () => <div className="my-5 h-px bg-slate-100" />;

/** The states a billing operation passes through, in one line. */
export const Stepper: React.FC<{ steps: string[]; current: number }> = ({ steps, current }) => (
  <div className="overflow-x-auto border-t border-slate-100 px-5 py-4">
    <div className="flex min-w-max items-center gap-3 sm:min-w-0">
      {steps.map((label, index) => {
        const done = index < current;
        const now = index === current;

        return (
          <div
            key={label}
            className={`flex flex-1 items-center gap-2 text-sm font-medium last:flex-none ${
              now ? 'text-blue-700' : done ? 'text-slate-700' : 'text-slate-400'
            }`}
          >
            <span
              aria-current={now ? 'step' : undefined}
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-emerald-500 text-white'
                  : now
                    ? 'bg-blue-500 text-white ring-4 ring-blue-100'
                    : 'bg-white text-slate-400 ring-1 ring-slate-200'
              }`}
            >
              {done ? '✓' : index + 1}
            </span>
            <span className="whitespace-nowrap">{label}</span>
            {index < steps.length - 1 && (
              <span
                className={`ml-1 h-0.5 min-w-6 flex-1 rounded-full ${done ? 'bg-emerald-300' : 'bg-slate-200'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const btnBase =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const btn = `${btnBase} bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900`;

export const btnPrimary = `${btnBase} bg-blue-500 px-4 text-white hover:bg-blue-600`;

export const btnWarn = `${btnBase} bg-white text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50`;

/** Solid red: the confirming button inside a destructive dialog. */
export const btnDanger = `${btnBase} bg-red-600 px-4 text-white hover:bg-red-700`;

export const Th: React.FC<{ align?: 'left' | 'right'; children?: React.ReactNode }> = ({
  align = 'left',
  children,
}) => (
  <th
    className={`sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

export const Td: React.FC<{
  align?: 'left' | 'right';
  className?: string;
  children?: React.ReactNode;
}> = ({ align = 'left', className = '', children }) => (
  <td
    className={`whitespace-nowrap px-5 py-3 text-sm text-slate-600 ${
      align === 'right' ? 'text-right' : ''
    } ${className}`}
  >
    {children}
  </td>
);

/** Classes for a body row, so every billing table hovers the same way. */
export const rowClass = 'transition-colors hover:bg-slate-50/80';

/** A table with nothing in it: an icon in a soft circle and one line, or a spinner while reading. */
export const Empty: React.FC<{
  span: number;
  children: React.ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
}> = ({ span, children, icon: Icon = Inbox, loading = false }) => (
  <tr>
    <td colSpan={span} className="px-5 py-10">
      <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
        {loading ? (
          <span
            aria-hidden
            className="size-5 animate-spin rounded-full border-2 border-blue-100 border-t-blue-500"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200"
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>
        )}
        <span>{children}</span>
      </div>
    </td>
  </tr>
);
