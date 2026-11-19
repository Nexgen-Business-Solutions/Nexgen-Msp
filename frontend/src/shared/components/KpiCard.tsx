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

// DeployOps stat tile: a soft colour tile for the icon, the label and number beside it, a quiet
// note underneath. "alert" turns orange while its number is above zero.
const neutralAccents: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  teal: 'bg-teal-50 text-teal-600 ring-teal-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
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
  const tile = raised ? 'bg-orange-50 text-orange-600 ring-orange-100' : neutralAccents[accent] ?? neutralAccents.blue;

  return (
    <div
      className={`flex h-full flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ${
        raised ? 'ring-orange-200' : 'ring-slate-200/70'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ring-1 ${tile}`}>
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-slate-600" title={label}>
            {label}
          </p>
          {loading ? (
            <span className="mt-1 block h-7 w-16 animate-pulse rounded-md bg-slate-100" />
          ) : (
            <p
              className={`truncate text-2xl font-bold leading-tight tabular-nums ${
                raised ? 'text-orange-700' : 'text-slate-900'
              }`}
              title={String(value)}
            >
              {value}
            </p>
          )}
        </div>
        {onView && (
          <button
            type="button"
            onClick={onView}
            aria-label={viewLabel ?? `View ${label}`}
            title={viewLabel ?? `View ${label}`}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
          >
            <Eye size={16} />
          </button>
        )}
      </div>

      {caption && (
        <p className={`mt-3 truncate text-[13px] ${raised ? 'text-orange-600' : 'text-slate-400'}`} title={caption}>
          {caption}
        </p>
      )}
    </div>
  );
};

export default KpiCard;
