import React from 'react';

// five meanings, five tones: waiting on someone (amber), agreed and being worked on (blue),
// done or live (emerald), refused or off (red), everything else at rest (slate)
const WAITING = 'bg-amber-100 text-amber-700';
const DONE = 'bg-emerald-100 text-emerald-700';
const UNDERWAY = 'bg-blue-100 text-blue-700';
const OFF = 'bg-red-100 text-red-700';

const PALETTE: Record<string, string> = {
  Pending: WAITING,
  'Awaiting Customer Approval': WAITING,
  'Awaiting Verification': WAITING,
  'On Hold': WAITING,
  'Pending Setup': WAITING,
  Suspended: WAITING,
  'Invoice Drafted': WAITING,
  Urgent: OFF,
  High: WAITING,
  Approved: UNDERWAY,
  'In Progress': UNDERWAY,
  Completed: DONE,
  Active: DONE,
  Invoiced: DONE,
  Posted: DONE,
  Rejected: OFF,
  Disabled: OFF,
  // a machine out of the fleet
  Retired: OFF,
  Damaged: OFF,
  Lost: OFF,
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
