import React from 'react';
import { Laptop, Mail, UserRound } from 'lucide-react';
import type { SubjectWorkGroup as Group } from '@/lib/api/internal';
import DeviceProvisioningWorkCard from './DeviceProvisioningWorkCard';
import ServiceWorkCard, { ServiceWorkResult } from './ServiceWorkCard';
import UserSetupWorkCard from './UserSetupWorkCard';

/** All the work owed to one person, in the order it can be done: them, their machine, their services. */
const SubjectWorkGroup: React.FC<{ group: Group; customer: string }> = ({ group, customer }) => {
  const person = group.person;

  const needsOf = (key: string) =>
    group.services
      .filter((card) => card.device_requirement_key === key)
      .map((card) => card.service_name ?? card.service_item ?? '')
      .filter(Boolean);

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <header className="mb-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-900">
          <UserRound size={15} className="text-slate-400" />
          {person?.full_name ?? 'Unnamed person'}
        </h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
          {person?.department && <span>{person.department}</span>}
          {person?.email && (
            <span className="inline-flex items-center gap-1">
              <Mail size={11} className="text-slate-400" />
              {person.email}
            </span>
          )}
          {person?.username && <span>{person.username}</span>}
          {person?.name && <span>{person.name}</span>}
          {person?.is_new && <span className="font-semibold text-blue-700">To be created</span>}
        </p>
      </header>

      <div className="space-y-3">
        {group.user_setup && <UserSetupWorkCard card={group.user_setup} person={person} />}

        {group.devices.map((slot) => (
          <DeviceProvisioningWorkCard
            key={slot.device_requirement_key}
            card={slot.work}
            customer={customer}
            person={person}
            needs={needsOf(slot.device_requirement_key)}
          />
        ))}

        {group.services.map((card) =>
          card.status === 'Awaiting Verification' ? (
            <ServiceWorkResult key={card.name} card={card} person={person} />
          ) : (
            <ServiceWorkCard key={card.name} card={card} person={person} />
          )
        )}

        {group.services.length === 0 && group.devices.length === 0 && !group.user_setup && (
          <p className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-slate-400">
            <Laptop size={12} />
            Nothing left to do for this person.
          </p>
        )}
      </div>
    </section>
  );
};

export default SubjectWorkGroup;
