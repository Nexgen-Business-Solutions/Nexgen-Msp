import React from 'react';
import RecordLink from '@/shared/components/RecordLink';
import type { RequestSubjectRow } from '@/lib/api/portal';

const Fact: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="mt-0.5 truncate text-xs font-medium text-slate-900">{value || '—'}</dd>
  </div>
);

const th =
  'whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500';

const RequestPersonSummary: React.FC<{ person: RequestSubjectRow }> = ({ person }) => (
  <section aria-label={`${person.full_name} details`} className="w-full basis-full">
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
      <Fact label="Department" value={person.department} />
      <Fact label="Email" value={person.email} />
      <Fact label="Username" value={person.username} />
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Record</dt>
        <dd className="mt-0.5 truncate text-xs font-medium text-slate-900">
          {person.kind === 'new' ? (
            'New person'
          ) : (
            <RecordLink name={person.client_user} kind="user">
              {person.client_user || '—'}
            </RecordLink>
          )}
        </dd>
      </div>
    </dl>

    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Device</th>
            <th className={th}>Type</th>
            <th className={th}>Serial number</th>
            <th className={th}>Current services</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {person.devices.map((device) => (
            <tr key={device.name} data-device={device.name}>
              <td className="px-3 py-2 text-xs font-semibold text-slate-900">
                <RecordLink name={device.name} kind="device">
                  {device.hostname || device.label}
                </RecordLink>
              </td>
              <td className="px-3 py-2 text-xs text-slate-700">{device.device_type || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-700">{device.serial_number || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-700">
                {person.current_services
                  .filter((service) => service.managed_device === device.name)
                  .map((service) => service.label)
                  .join(', ') || '—'}
              </td>
            </tr>
          ))}

          {person.devices.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-3 text-xs text-slate-500">
                No Device.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
);

export default RequestPersonSummary;
