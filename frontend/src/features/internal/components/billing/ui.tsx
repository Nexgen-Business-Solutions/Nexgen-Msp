import React from 'react';

/**
 * The Billing module's own vocabulary, taken from the approved R04 prototype.
 *
 * Every Billing screen is built from these pieces, so a card, a pill or a table reads the
 * same on the landing page, on a run and on an invoice.
 */

export const TONES = {
  blue: 'border-blue-100 bg-blue-50 text-blue-700',
  green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-100 bg-amber-50 text-amber-700',
  red: 'border-rose-100 bg-rose-50 text-rose-700',
  gray: 'border-slate-200 bg-slate-50 text-slate-600',
  purple: 'border-violet-100 bg-violet-50 text-violet-700',
} as const;

export type Tone = keyof typeof TONES;

export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode }> = ({
  tone = 'gray',
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold ${TONES[tone]}`}
  >
    {children}
  </span>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <section
    className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
  >
    {children}
  </section>
);

export const CardHead: React.FC<{
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ title, hint, right }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
    <div className="min-w-0">
      <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{title}</h2>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
    {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
  </div>
);

export const Foot: React.FC<{ left?: React.ReactNode; right?: React.ReactNode }> = ({
  left,
  right,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
    <span>{left}</span>
    <span>{right}</span>
  </div>
);

/** One line of facts under a title: what this document is, without opening anything. */
export const ContextBar: React.FC<{ facts: { label: string; value: React.ReactNode }[] }> = ({
  facts,
}) => (
  <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-[11px] text-slate-500">
    {facts.map((fact) => (
      <span key={fact.label}>
        {fact.label} <b className="font-semibold text-slate-700">{fact.value}</b>
      </span>
    ))}
  </div>
);

export const Banner: React.FC<{
  tone?: 'amber' | 'blue' | 'green';
  title?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ tone = 'amber', title, children }) => {
  const look = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  }[tone];

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-xs ${look}`}>
      <div className="min-w-0">
        {title && <strong className="font-bold">{title}</strong>}{' '}
        <span className="font-medium">{children}</span>
      </div>
    </div>
  );
};

export const Metric: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-[11px] font-medium text-slate-400">{label}</p>
    <p className="mt-1 truncate text-lg font-bold tabular-nums text-slate-900" title={String(value)}>
      {value}
    </p>
    {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
  </div>
);

export const InfoPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <aside className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">{children}</aside>
);

export const PanelTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-3 text-xs font-bold text-slate-900">{children}</h3>
);

/** Label on the left, value on the right: the shape every side panel repeats. */
export const Summary: React.FC<{ rows: { label: string; value: React.ReactNode }[] }> = ({
  rows,
}) => (
  <dl className="space-y-2.5">
    {rows.map((row) => (
      <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
        <dt className="text-slate-400">{row.label}</dt>
        <dd className="min-w-0 truncate text-right font-semibold text-slate-700">{row.value}</dd>
      </div>
    ))}
  </dl>
);

export const Divider: React.FC = () => <div className="my-4 h-px bg-slate-200/70" />;

/** The four states a billing operation passes through, in one line. */
export const Stepper: React.FC<{ steps: string[]; current: number }> = ({ steps, current }) => (
  <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-3.5">
    {steps.map((label, index) => {
      const done = index < current;
      const now = index === current;

      return (
        <div
          key={label}
          className={`flex flex-1 items-center gap-2 text-xs font-semibold last:flex-none ${
            now ? 'text-blue-700' : done ? 'text-slate-600' : 'text-slate-400'
          }`}
        >
          <span
            aria-current={now ? 'step' : undefined}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
              done
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : now
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            {done ? '✓' : index + 1}
          </span>
          <span className="whitespace-nowrap">{label}</span>
          {index < steps.length - 1 && (
            <span className={`ml-1 h-px flex-1 ${done ? 'bg-emerald-200' : 'bg-slate-200'}`} />
          )}
        </div>
      );
    })}
  </div>
);

export const btn =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

export const btnWarn =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50';

export const Th: React.FC<{ align?: 'left' | 'right'; children?: React.ReactNode }> = ({
  align = 'left',
  children,
}) => (
  <th
    className={`sticky top-0 z-10 whitespace-nowrap border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-[11px] font-bold text-slate-500 ${
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
    className={`whitespace-nowrap px-5 py-3 text-xs text-slate-600 ${
      align === 'right' ? 'text-right' : ''
    } ${className}`}
  >
    {children}
  </td>
);

export const Empty: React.FC<{ span: number; children: React.ReactNode }> = ({ span, children }) => (
  <tr>
    <td colSpan={span} className="px-5 py-12 text-center text-xs text-slate-400">
      {children}
    </td>
  </tr>
);
