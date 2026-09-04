import React from 'react';

// four meanings, four tones: waiting on someone (amber), done or live (emerald),
// refused or off (red), everything else at rest (slate)
const WAITING = 'bg-amber-100 text-amber-700';
const DONE = 'bg-emerald-100 text-emerald-700';
const OFF = 'bg-red-100 text-red-700';

const PALETTE: Record<string, string> = {
  Pending: WAITING,
  'Awaiting Customer Approval': WAITING,
  'Awaiting Verification': WAITING,
  'On Hold': WAITING,
  'Pending Setup': WAITING,
  'Pending Removal': WAITING,
  Suspended: WAITING,
  'Invoice Drafted': WAITING,
  Urgent: OFF,
  High: WAITING,
  Approved: DONE,
  Completed: DONE,
  Active: DONE,
  Invoiced: DONE,
  Posted: DONE,
  Rejected: OFF,
  Disabled: OFF,
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
