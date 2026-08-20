import React from 'react';

const PALETTE: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Submitted: 'bg-blue-100 text-blue-700',
  'Under Review': 'bg-indigo-100 text-indigo-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  'Invoice Drafted': 'bg-amber-100 text-amber-700',
  Invoiced: 'bg-emerald-100 text-emerald-700',
  Posted: 'bg-emerald-100 text-emerald-700',
  'In Progress': 'bg-sky-100 text-sky-700',
  Completed: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-slate-100 text-slate-500',
  Pending: 'bg-amber-100 text-amber-700',
  Active: 'bg-emerald-100 text-emerald-700',
  Disabled: 'bg-red-100 text-red-700',
  Urgent: 'bg-red-100 text-red-700',
  High: 'bg-orange-100 text-orange-700',
  Medium: 'bg-slate-100 text-slate-600',
  Low: 'bg-slate-100 text-slate-500',
  Add: 'bg-emerald-50 text-emerald-700',
  Change: 'bg-blue-50 text-blue-700',
  Suspend: 'bg-amber-50 text-amber-700',
  Resume: 'bg-sky-50 text-sky-700',
  Remove: 'bg-red-50 text-red-700',
  Mixed: 'bg-indigo-50 text-indigo-700',
};

const StatusBadge: React.FC<{ value?: string | null; className?: string }> = ({
  value,
  className = '',
}) => {
  if (!value) return <span className="text-sm text-slate-400">N/A</span>;

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        PALETTE[value] || 'bg-slate-100 text-slate-600'
      } ${className}`}
    >
      {value.toUpperCase()}
    </span>
  );
};

export default StatusBadge;
