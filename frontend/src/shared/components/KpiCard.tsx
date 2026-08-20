import React from 'react';
import { Eye, type LucideIcon } from 'lucide-react';

export type KpiTone = 'neutral' | 'alert';

type KpiCardProps = {
  icon: LucideIcon;
  label: string;
  value: string | number;
  caption?: string;
  tone?: KpiTone;
  accent?: string;
  loading?: boolean;
  onView?: () => void;
  viewLabel?: string;
};

const neutralAccents: Record<string, { bg: string; text: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-500' },
};

const KpiCard: React.FC<KpiCardProps> = ({
  icon: Icon,
  label,
  value,
  caption,
  tone = 'neutral',
  accent = 'blue',
  loading = false,
  onView,
  viewLabel,
}) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  const raised = tone === 'alert' && Number.isFinite(numeric) && numeric > 0;

  const palette = raised
    ? { bg: 'bg-amber-50', text: 'text-amber-600' }
    : neutralAccents[accent] ?? neutralAccents.blue;

  return (
    <div
      className={`flex flex-col justify-between rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
        raised ? 'border-amber-200' : 'border-slate-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500" title={label}>
            {label}
          </p>
          {loading ? (
            <span className="mt-1.5 block h-7 w-16 animate-pulse rounded-md bg-slate-100" />
          ) : (
            <p
              className={`mt-0.5 truncate text-2xl font-bold tabular-nums ${
                raised ? 'text-amber-700' : 'text-slate-900'
              }`}
              title={String(value)}
            >
              {value}
            </p>
          )}
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${palette.bg}`}
        >
          <Icon size={20} className={palette.text} />
        </span>
      </div>

      {(caption || onView) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className={`min-w-0 truncate text-xs ${raised ? 'text-amber-600' : 'text-slate-400'}`}>
            {caption}
          </p>
          {onView && (
            <button
              type="button"
              onClick={onView}
              aria-label={viewLabel ?? `View ${label}`}
              title={viewLabel ?? `View ${label}`}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                raised
                  ? 'text-amber-500 hover:bg-amber-100 hover:text-amber-700'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              <Eye size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default KpiCard;
