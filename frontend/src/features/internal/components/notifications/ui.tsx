import React from 'react';
import { Info } from 'lucide-react';

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate';

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  slate: 'bg-slate-100 text-slate-600',
};

export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string }> = ({
  tone = 'slate',
  children,
  title,
}) => (
  <span
    title={title}
    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}
  >
    {children}
  </span>
);

export const InfoStrip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2.5 border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-sm leading-relaxed text-slate-600">
    <Info size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
    <p>{children}</p>
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
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 ${
      checked ? 'bg-blue-600' : 'bg-slate-300'
    }`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500';

export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, className = '', children }) => (
  <div className={`min-w-0 ${className}`}>
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-slate-500">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
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
    className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={`h-9 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${
          value === option.value
            ? 'bg-white text-blue-700 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
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
  children?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ tone = 'empty', title, children, action }) => (
  <div
    role={tone === 'error' ? 'alert' : undefined}
    className="flex flex-col items-center gap-1 px-6 py-14 text-center"
  >
    <p className={`text-sm font-semibold ${tone === 'error' ? 'text-red-700' : 'text-slate-700'}`}>
      {title}
    </p>
    {children && <p className="max-w-md text-sm text-slate-500">{children}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export const SkeletonRows: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="h-10 animate-pulse rounded-lg bg-slate-100" />
    ))}
  </div>
);
