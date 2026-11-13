import React from 'react';
import StatusBadge from '@/shared/components/StatusBadge';
import { today } from '@/shared/lib/today';

/**
 * What a service is doing, and from when.
 *
 * A pause takes effect on its own day, and that day can be one still to come. The record
 * reads Suspended from the moment it is written, so the badge on its own says a service is
 * paused while it is still running and still being billed. The day is the whole difference.
 */
const ServiceState: React.FC<{ status: string; suspendedFrom?: string | null }> = ({
  status,
  suspendedFrom,
}) => {
  const from = suspendedFrom ? String(suspendedFrom).slice(0, 10) : null;
  const later = status === 'Suspended' && from ? from > today() : false;

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatusBadge value={status} />
      {later && <span className="text-[10px] text-slate-500">from {from}</span>}
    </span>
  );
};

export default ServiceState;
