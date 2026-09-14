import React from 'react';
import type { PersonFacts } from '@/lib/api/internal';
import { fmtDate, pill } from '../../lib/fulfilmentStyles';

type Props = {
  fullName: string;
  /** what is on file, when the person already exists */
  facts?: PersonFacts | null;
  /** what the request says, when they do not exist yet */
  asked?: { department?: string | null; email?: string | null; username?: string | null } | null;
  isNew?: boolean;
  children?: React.ReactNode;
};

const Field: React.FC<{ label: string; children: React.ReactNode; wide?: boolean }> = ({
  label,
  children,
  wide,
}) => (
  <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <div className="mt-0.5 break-words text-sm text-slate-800">{children}</div>
  </div>
);

const orDash = (value?: string | null) => value || '—';

/** Who a group of lines is for, with what is on file about them, each value under its label. */
const PersonHeader: React.FC<Props> = ({ fullName, facts, asked, isNew, children }) => (
  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-900">{fullName}</p>
        {isNew && <span className={pill('blue')}>New person</span>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>

    {isNew ? (
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Field label="Department">{orDash(asked?.department)}</Field>
        <Field label="Email">{orDash(asked?.email)}</Field>
        <Field label="Username">{orDash(asked?.username)}</Field>
      </div>
    ) : (
      facts && (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Client User">{facts.name}</Field>
          <Field label="Department">{orDash(facts.department)}</Field>
          <Field label="Email">{orDash(facts.email)}</Field>
          <Field label="Username">{orDash(facts.username)}</Field>
          <Field label="Lifecycle Status">
            {facts.lifecycle_status}
            {facts.disabled_date ? ` · ${fmtDate(facts.disabled_date)}` : ''}
          </Field>
          <Field label="Devices" wide>
            {facts.devices.length
              ? facts.devices
                  .map((device) => [device.hostname, device.serial_number].filter(Boolean).join(' · '))
                  .join(', ')
              : '—'}
          </Field>
          <Field label="Services">
            {facts.services.length
              ? facts.services
                  .map((service) =>
                    `${service.service_name}${service.hostname ? ` · ${service.hostname}` : ''}${
                      service.status === 'Active' ? '' : ` (${service.status})`
                    }`
                  )
                  .join(', ')
              : '—'}
          </Field>
          {facts.open_requests.length > 0 && (
            <Field label="Other Open Requests" wide>
              {facts.open_requests.map((row) => row.name).join(', ')}
            </Field>
          )}
        </div>
      )
    )}
  </div>
);

export default PersonHeader;
