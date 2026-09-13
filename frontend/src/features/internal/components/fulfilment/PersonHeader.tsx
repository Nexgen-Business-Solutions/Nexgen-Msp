import React from 'react';
import { FileText, Laptop, Layers } from 'lucide-react';
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

const Fact: React.FC<{ icon: typeof Laptop; label: string; children: React.ReactNode }> = ({
  icon: Icon,
  label,
  children,
}) => (
  <div className="flex min-w-0 items-start gap-1.5 text-xs text-slate-600">
    <Icon size={13} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
    <span className="sr-only">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

/** Who a group of lines is for, with what is worth knowing about them before deciding or acting. */
const PersonHeader: React.FC<Props> = ({ fullName, facts, asked, isNew, children }) => {
  const meta = isNew
    ? [asked?.department, asked?.email, asked?.username && `Account ${asked.username}`]
    : [facts?.department, facts?.email, facts?.username && `Account ${facts.username}`, facts?.name];

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-900">{fullName}</p>
          {isNew ? (
            <span className={pill('blue')}>New person</span>
          ) : (
            facts?.lifecycle_status &&
            facts.lifecycle_status !== 'Active' && (
              <span className={pill('pending')}>
                {facts.lifecycle_status}
                {facts.disabled_date ? ` since ${fmtDate(facts.disabled_date)}` : ''}
              </span>
            )
          )}
        </div>

        <p className="text-xs text-slate-500">{meta.filter(Boolean).join(' · ') || 'No details on file'}</p>

        {isNew ? (
          <p className="text-xs text-slate-500">Not on file yet — created during execution.</p>
        ) : (
          facts && (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Fact icon={Laptop} label="Devices">
                {facts.devices.length
                  ? facts.devices
                      .map((device) =>
                        [device.hostname, device.serial_number].filter(Boolean).join(' · ')
                      )
                      .join(', ')
                  : 'No device in hand'}
              </Fact>
              <Fact icon={Layers} label="Services">
                {facts.services.length
                  ? facts.services
                      .map((service) =>
                        service.status === 'Active' ? service.service_name : `${service.service_name} (${service.status.toLowerCase()})`
                      )
                      .join(', ')
                  : 'No personal service'}
              </Fact>
              {facts.open_requests.length > 0 && (
                <Fact icon={FileText} label="Other open requests">
                  <span className="text-amber-700">
                    Also in {facts.open_requests.map((row) => row.name).join(', ')}
                  </span>
                </Fact>
              )}
            </div>
          )
        )}
      </div>

      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
};

export default PersonHeader;
