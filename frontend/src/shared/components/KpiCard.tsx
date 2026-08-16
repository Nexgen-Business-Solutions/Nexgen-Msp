import React from 'react';
import type { LucideIcon } from 'lucide-react';

type KpiCardProps = {
  icon: LucideIcon;
  iconBg: string;
  iconClass: string;
  label: string;
  value: string;
  caption: string;
};

const KpiCard: React.FC<KpiCardProps> = ({ icon: Icon, iconBg, iconClass, label, value, caption }) => (
  <div className="flex flex-col rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
    <div className="flex items-start gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon size={20} className={iconClass} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500" title={label}>
          {label}
        </p>
        <p
          className="mt-0.5 truncate text-lg font-bold text-slate-900 tabular-nums xl:text-xl 2xl:text-2xl"
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
    <p className="mt-2 text-xs text-slate-400">{caption}</p>
  </div>
);

export default KpiCard;
