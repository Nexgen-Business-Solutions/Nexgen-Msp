import React from 'react';
import { CircleAlert, Info, Inbox, type LucideIcon } from 'lucide-react';

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate';

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  slate: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string }> = ({
  tone = 'slate',
  children,
  title,
}) => (
  <span
    title={title}
    className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONES[tone]}`}
  >
    {children}
  </span>
);

/** Buttons shared by the notification screens, so every action reads the same. */
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

/** The same secondary button, a size down, for inside table rows and toolbars. */
export const btnSmall =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

/** Hairline table header cell, as on the dashboard. Horizontal padding is the caller's, to line up with its cells. */
export const thClass =
  'whitespace-nowrap border-b border-slate-200 bg-white py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500';

/** A row a person can open. */
export const rowClass = 'transition-colors hover:bg-slate-50/80';

export const InfoStrip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-3 px-5 pt-5 sm:px-6">
    <div className="flex w-full items-start gap-3 rounded-2xl bg-slate-50/80 px-4 py-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200/60">
      <span className="mt-px grid size-6 shrink-0 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200">
        <Info size={14} aria-hidden />
      </span>
      <p>{children}</p>
    </div>
  </div>
);

export const Switch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}> = ({ checked, onChange, label, disabled, describedBy }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    aria-describedby={describedBy}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
      checked ? 'bg-blue-500' : 'bg-slate-300'
    }`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
        checked ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

export const inputClass =
  'h-10 w-full rounded-md border-0 bg-slate-100/80 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export const textareaClass =
  'w-full rounded-xl border-0 bg-slate-100/80 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-500';

export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, className = '', children }) => (
  <div className={`min-w-0 ${className}`}>
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-slate-600">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
  </div>
);

export const Segmented: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}> = ({ value, onChange, options, label }) => (
  <div
    role="group"
    aria-label={label}
    className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-slate-100/80 p-1"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          value === option.value
            ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70'
            : 'text-slate-500 hover:text-slate-800'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const Message: React.FC<{
  tone?: 'error' | 'empty';
  title: string;
  icon?: LucideIcon;
  children?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ tone = 'empty', title, icon, children, action }) => {
  const Icon = icon ?? (tone === 'error' ? CircleAlert : Inbox);

  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className="flex flex-col items-center gap-1 px-6 py-14 text-center"
    >
      <span
        className={`mb-2 grid size-10 place-items-center rounded-full ring-1 ${
          tone === 'error'
            ? 'bg-red-50 text-red-600 ring-red-100'
            : 'bg-slate-50 text-slate-400 ring-slate-200'
        }`}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <p className={`text-sm font-semibold ${tone === 'error' ? 'text-red-700' : 'text-slate-800'}`}>
        {title}
      </p>
      {children && <p className="max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
};

export const SkeletonRows: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-2 p-5 sm:px-6" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="h-10 animate-pulse rounded-xl bg-slate-100/80" />
    ))}
  </div>
);
