import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { NotificationChannel } from '@/lib/api/internal';
import Select from '@/shared/components/Select';
import { Switch, btnSmall, inputClass } from './ui';
import type { PolicyRow } from './format';

const CHANNELS: NotificationChannel[] = ['To', 'CC', 'BCC'];

const FIXED = '__fixed__';

/** A row with nothing in it yet: a copy to a fixed address, which is the common case. */
const blank = (): PolicyRow => ({
  channel: 'CC',
  recipient_source: null,
  recipient_source_label: null,
  fixed_address: '',
  enabled: true,
});

const RecipientPolicies: React.FC<{
  rows: PolicyRow[];
  sources: { key: string; label: string }[];
  audienceLabel: string;
  precedenceNote: string;
  locked: boolean;
  idBase: string;
  onChange: (rows: PolicyRow[]) => void;
}> = ({ rows, sources, audienceLabel, precedenceNote, locked, idBase, onChange }) => {
  const patch = (index: number, change: Partial<PolicyRow>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));

  if (locked) {
    return (
      <p className="rounded-xl bg-slate-50/70 px-3.5 py-3 text-sm text-slate-600 ring-1 ring-slate-200/60">
        This notification carries the means of signing in as somebody, so it reaches{' '}
        {audienceLabel.toLowerCase()} and nobody else. It cannot be copied or redirected.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Addressed to <span className="font-semibold text-slate-700">{audienceLabel}</span>, which
        the application resolves from the record itself. Anything below is sent in addition.
      </p>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={index}
              className="grid gap-2 rounded-xl bg-slate-50/70 p-2.5 ring-1 ring-slate-200/60 sm:grid-cols-[7rem_1fr_1fr_auto_auto] sm:items-center"
            >
              <Select
                label={`Channel of copy ${index + 1}`}
                value={row.channel}
                onChange={(value) => patch(index, { channel: value as NotificationChannel })}
                options={CHANNELS.map((channel) => ({ value: channel, label: channel }))}
                searchable={false}
              />
              <Select
                label={`Who copy ${index + 1} goes to`}
                value={row.recipient_source ?? FIXED}
                onChange={(value) =>
                  patch(index, {
                    recipient_source: value === FIXED ? null : value,
                    recipient_source_label:
                      value === FIXED
                        ? null
                        : (sources.find((entry) => entry.key === value)?.label ?? null),
                    fixed_address: value === FIXED ? (row.fixed_address ?? '') : null,
                  })
                }
                options={[
                  { value: FIXED, label: 'A fixed address' },
                  ...sources.map((entry) => ({ value: entry.key, label: entry.label })),
                ]}
                searchable={false}
              />
              {row.recipient_source ? (
                <p className="truncate text-sm text-slate-500">
                  Resolved from the record on every send
                </p>
              ) : (
                <input
                  type="email"
                  aria-label={`Address of copy ${index + 1}`}
                  value={row.fixed_address ?? ''}
                  onChange={(event) => patch(index, { fixed_address: event.target.value })}
                  placeholder="ops@example.com"
                  className={inputClass}
                />
              )}
              <Switch
                label={`Copy ${index + 1} enabled`}
                checked={row.enabled}
                onChange={(next) => patch(index, { enabled: next })}
              />
              <button
                type="button"
                aria-label={`Remove copy ${index + 1}`}
                onClick={() => onChange(rows.filter((_, at) => at !== index))}
                className="justify-self-end rounded-full p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange([...rows, blank()])}
          id={`${idBase}-add-policy`}
          className={btnSmall}
        >
          <Plus size={14} aria-hidden />
          Add a copy
        </button>
        <p className="text-xs text-slate-500">{precedenceNote}</p>
      </div>
    </div>
  );
};

export default RecipientPolicies;
