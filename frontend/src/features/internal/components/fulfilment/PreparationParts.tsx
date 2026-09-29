import React from 'react';
import { compactBadge } from '../../lib/workDisplay';

const shown = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
};

export const RequestedInformation: React.FC<{
  snapshot: Record<string, unknown>;
  fields: [string, string][];
}> = ({ snapshot, fields }) => (
  <section
    aria-label="Requested information"
    className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5"
  >
    <p className="text-xs font-semibold text-slate-800">Requested information</p>
    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {fields.map(([key, label]) => (
        <div key={key} className="flex gap-1">
          <dt className="text-slate-400">{label}:</dt>
          <dd className="font-medium text-slate-700">{shown(snapshot[key])}</dd>
        </div>
      ))}
    </dl>
  </section>
);

export const PreparationTabs = <T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div role="tablist" className="flex gap-1.5">
    {tabs.map(([key, label]) => (
      <button
        key={key}
        type="button"
        role="tab"
        aria-selected={value === key}
        onClick={() => onChange(key)}
        className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
          value === key
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

export const SelectableRow: React.FC<{
  group: string;
  value: string;
  checked: boolean;
  selectable: boolean;
  title: string;
  detail: string;
  badge: string;
  reason?: string | null;
  onSelect: () => void;
}> = ({ group, value, checked, selectable, title, detail, badge, reason, onSelect }) => (
  <label
    data-selectable={selectable ? 'true' : 'false'}
    title={selectable ? undefined : (reason ?? undefined)}
    className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-slate-100 px-3 py-2 last:border-b-0 ${
      selectable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed bg-slate-50 text-slate-400'
    }`}
  >
    <input
      type="radio"
      name={group}
      value={value}
      checked={checked}
      disabled={!selectable}
      onChange={onSelect}
      aria-label={title}
      className="h-4 w-4"
    />
    <span className="min-w-0">
      <span className={`block truncate text-sm font-semibold ${selectable ? 'text-slate-900' : 'text-slate-400'}`}>
        {title}
      </span>
      <span className={`block truncate text-xs ${selectable ? 'text-slate-500' : 'text-slate-400'}`}>
        {detail}
      </span>
    </span>
    <span
      className={`${compactBadge} ${
        selectable ? 'border-slate-200 bg-white text-slate-600' : 'border-slate-200 bg-slate-100 text-slate-500'
      }`}
    >
      {badge}
    </span>
  </label>
);
