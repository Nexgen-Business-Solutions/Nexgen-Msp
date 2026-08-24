import React from 'react';
import { CircleCheck, CircleSlash, Info } from 'lucide-react';
import { useServiceState } from '../hooks/usePortal';

type Props = {
  serviceItem?: string;
  clientUser?: string;
  managedDevice?: string;
};

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : null);

/** What the holder already has of this service, shown the moment it is picked. */
const ServiceStateHint: React.FC<Props> = ({ serviceItem, clientUser, managedDevice }) => {
  const state = useServiceState(serviceItem, clientUser, managedDevice);

  if (!serviceItem || (!clientUser && !managedDevice)) return null;
  if (state.isLoading || !state.data) return null;

  if (!state.data.held) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <Info size={15} className="mt-0.5 shrink-0 text-slate-400" />
        <p className="text-xs text-slate-600">Not held yet — this would be a new service.</p>
      </div>
    );
  }

  const { live, status, since, until, last_billed_on: lastBilled } = state.data;

  const facts = [
    since && `since ${fmtDate(since)}`,
    until && `ended ${fmtDate(until)}`,
    lastBilled ? `last billed ${fmtDate(lastBilled)}` : 'never billed',
  ].filter(Boolean);

  return (
    <div
      className={`mt-2 flex items-start gap-2 rounded-lg border p-2.5 ${
        live ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      {live ? (
        <CircleCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" />
      ) : (
        <CircleSlash size={15} className="mt-0.5 shrink-0 text-amber-600" />
      )}
      <p className={`text-xs ${live ? 'text-emerald-800' : 'text-amber-800'}`}>
        <span className="font-semibold">{status}</span>
        {facts.length > 0 && <> · {facts.join(' · ')}</>}
      </p>
    </div>
  );
};

export default ServiceStateHint;
