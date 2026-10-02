import React from 'react';
import RecordLink from '@/shared/components/RecordLink';
import type { RequestSubjectRow } from '@/lib/api/portal';

const Fact: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="mt-0.5 truncate text-xs font-medium text-slate-900">{value || '—'}</dd>
  </div>
);

/**
 * A machine the request is about, with nobody behind it.
 *
 * There is no department, no email and no personal service to show, because there is no
 * person: what is worth reading is the machine itself and what already runs on it.
 */
const RequestDeviceSummary: React.FC<{ device: RequestSubjectRow }> = ({ device }) => {
  const machine = device.devices[0];

  return (
    <section aria-label={`${device.full_name} details`} className="w-full basis-full">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        <Fact label="Type" value={machine?.device_type} />
        <Fact label="Serial number" value={machine?.serial_number} />
        <Fact label="Status" value={machine?.status} />
        <Fact
          label="Record"
          value={
            device.managed_device ? (
              <RecordLink name={device.managed_device} kind="device">
                {device.managed_device}
              </RecordLink>
            ) : (
              'New Device'
            )
          }
        />
      </dl>

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Current services
        </p>
        <p className="mt-0.5 text-xs text-slate-700">
          {device.current_services.map((service) => service.label).join(', ') || 'None.'}
        </p>
      </div>
    </section>
  );
};

export default RequestDeviceSummary;
