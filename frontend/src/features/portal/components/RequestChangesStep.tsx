import React from 'react';
import { AlertCircle, Laptop, Wrench } from 'lucide-react';
import type { RequestAction } from '@/lib/api/portal';
import { useNewUserRequestContext, useRequestSubjectContext } from '../hooks/usePortal';
import { staleReason, type RequestSubject, type useRequestBuilder } from '../hooks/useRequestBuilder';
import { AvailableServiceRow, CurrentServiceRow } from './RequestServiceCard';

type Builder = ReturnType<typeof useRequestBuilder>;

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
    {children}
  </div>
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
    <span className="text-sm text-amber-900">{children}</span>
  </div>
);

/** What can be asked for an existing person: what they hold, and what they could hold. */
const ExistingSubjectChanges: React.FC<{ subject: RequestSubject; builder: Builder }> = ({
  subject,
  builder,
}) => {
  const context = useRequestSubjectContext(subject.clientUser);

  if (context.isLoading) {
    return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (context.error || !context.data) {
    return (
      <p className="py-8 text-center text-sm text-red-600">
        {(context.error as Error)?.message || 'This person could not be read.'}
      </p>
    );
  }

  const data = context.data;

  const act = (
    action: RequestAction,
    service: { service_item: string; label: string; assignment?: string },
    device?: { name: string; hostname: string }
  ) =>
    builder.addIntent({
      subjectKey: subject.key,
      action: action.action_type,
      requestAction: action.name,
      actionLabel: action.title || action.action_type,
      serviceItem: service.service_item,
      serviceLabel: service.label,
      targetScope: device ? 'Device' : 'User',
      sourceServiceAssignment: service.assignment,
      managedDevice: device?.name,
      deviceLabel: device?.hostname,
    });

  // an intention written earlier may no longer make sense: somebody else may have moved
  // the very service it was about while the draft sat there
  const stale = builder
    .intentsOf(subject.key)
    .map((intent) => ({ intent, reason: staleReason(intent, data) }))
    .filter((row) => row.reason);

  return (
    <div className="space-y-4">
      {data.target_reason && <Note>{data.target_reason}</Note>}

      {stale.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          {stale.map(({ intent, reason }) => (
            <div key={intent.key} className="flex items-start justify-between gap-3">
              <p className="text-sm text-amber-900">
                {reason} Review this item before submitting.
              </p>
              <button
                type="button"
                onClick={() => builder.removeIntent(intent.key)}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                Remove it
              </button>
            </div>
          ))}
        </div>
      )}

      <Section title="Personal services" hint="Services this person holds in their own name.">
        {data.personal_services.current.length === 0 && (
          <p className="px-4 py-5 text-sm text-slate-500">No personal service yet.</p>
        )}
        {data.personal_services.current.map((service) => {
          const asked = builder.askedOn(service.assignment);

          return (
            <CurrentServiceRow
              key={service.assignment}
              service={service}
              askedAction={asked?.actionLabel}
              onAct={(action) =>
                act(action, {
                  service_item: service.service_item,
                  label: service.label,
                  assignment: service.assignment,
                })
              }
              onUndo={() => asked && builder.removeIntent(asked.key)}
            />
          );
        })}

        {data.personal_services.available.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
            {data.personal_services.available.map((offer) => {
              const asked = builder
                .intentsOf(subject.key)
                .find(
                  (intent) =>
                    intent.serviceItem === offer.service_item && intent.targetScope === 'User'
                );

              return (
                <AvailableServiceRow
                  key={offer.service_item}
                  offer={offer}
                  asked={Boolean(asked)}
                  onAdd={(action) =>
                    act(action, { service_item: offer.service_item, label: offer.item_name })
                  }
                  onUndo={() => asked && builder.removeIntent(asked.key)}
                />
              );
            })}
          </div>
        )}
      </Section>

      {data.devices.length === 0 ? (
        <Section title="Devices">
          <p className="px-4 py-5 text-sm text-slate-500">
            No device currently assigned to {subject.fullName}. A technician will identify or
            prepare one if a device service is needed.
          </p>
        </Section>
      ) : (
        data.devices.map((device) => (
          <Section
            key={device.name}
            title={device.hostname}
            hint={[
              device.serial_number ? `Serial: ${device.serial_number}` : 'Serial: not recorded',
              device.device_type,
              device.status,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {device.target_reason && (
              <div className="px-4 pt-3">
                <Note>{device.target_reason}</Note>
              </div>
            )}

            {device.services.current.length === 0 && (
              <p className="px-4 py-5 text-sm text-slate-500">
                <Laptop size={14} className="mr-1.5 inline text-slate-400" />
                Nothing runs on this machine yet.
              </p>
            )}
            {device.services.current.map((service) => {
              const asked = builder.askedOn(service.assignment);

              return (
                <CurrentServiceRow
                  key={service.assignment}
                  service={service}
                  askedAction={asked?.actionLabel}
                  onAct={(action) =>
                    act(
                      action,
                      {
                        service_item: service.service_item,
                        label: service.label,
                        assignment: service.assignment,
                      },
                      { name: device.name, hostname: device.hostname }
                    )
                  }
                  onUndo={() => asked && builder.removeIntent(asked.key)}
                />
              );
            })}

            {device.services.available.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
                {device.services.available.map((offer) => {
                  const asked = builder
                    .intentsOf(subject.key)
                    .find(
                      (intent) =>
                        intent.serviceItem === offer.service_item &&
                        intent.managedDevice === device.name
                    );

                  return (
                    <AvailableServiceRow
                      key={offer.service_item}
                      offer={offer}
                      asked={Boolean(asked)}
                      onAdd={(action) =>
                        act(
                          action,
                          { service_item: offer.service_item, label: offer.item_name },
                          { name: device.name, hostname: device.hostname }
                        )
                      }
                      onUndo={() => asked && builder.removeIntent(asked.key)}
                    />
                  );
                })}
              </div>
            )}
          </Section>
        ))
      )}
    </div>
  );
};

/** For somebody who does not exist yet, everything the contract covers is on offer. */
const NewSubjectChanges: React.FC<{ subject: RequestSubject; builder: Builder }> = ({
  subject,
  builder,
}) => {
  const context = useNewUserRequestContext();

  if (context.isLoading) {
    return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>;
  }

  const data = context.data;

  if (!data) return null;

  const offer = (scope: 'User' | 'Device') =>
    scope === 'User' ? data.available_user_services : data.available_device_services;

  const pick = (action: RequestAction, item: { service_item: string; item_name: string }, scope: 'User' | 'Device') =>
    builder.addIntent({
      subjectKey: subject.key,
      action: action.action_type,
      requestAction: action.name,
      actionLabel: action.title || action.action_type,
      serviceItem: item.service_item,
      serviceLabel: item.item_name,
      targetScope: scope,
      isNewDevice: scope === 'Device',
    });

  return (
    <div className="space-y-4">
      <Section title="Personal services" hint="Granted to this person once they are created.">
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {offer('User').length === 0 && (
            <p className="text-sm text-slate-500">Nothing is available under your contract.</p>
          )}
          {offer('User').map((item) => {
            const asked = builder
              .intentsOf(subject.key)
              .find(
                (intent) =>
                  intent.serviceItem === item.service_item && intent.targetScope === 'User'
              );

            return (
              <AvailableServiceRow
                key={item.service_item}
                offer={item}
                asked={Boolean(asked)}
                onAdd={(action) => pick(action, item, 'User')}
                onUndo={() => asked && builder.removeIntent(asked.key)}
              />
            );
          })}
        </div>
      </Section>

      <Section
        title="Device services"
        hint="A technician will prepare or identify the machine these run on."
      >
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {offer('Device').map((item) => {
            const asked = builder
              .intentsOf(subject.key)
              .find(
                (intent) =>
                  intent.serviceItem === item.service_item && intent.targetScope === 'Device'
              );

            return (
              <AvailableServiceRow
                key={item.service_item}
                offer={item}
                asked={Boolean(asked)}
                onAdd={(action) => pick(action, item, 'Device')}
                onUndo={() => asked && builder.removeIntent(asked.key)}
              />
            );
          })}
        </div>

        {builder
          .intentsOf(subject.key)
          .some((intent) => intent.targetScope === 'Device' || intent.isNewDevice) && (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Wrench size={13} className="text-slate-400" />
              Device required — a technician will prepare or identify it.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
};

const RequestChangesStep: React.FC<{ builder: Builder }> = ({ builder }) => (
  <div className="space-y-6">
    {builder.subjects.map((subject) => (
      <div key={subject.key} className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-bold text-slate-900">
            {subject.fullName || 'New person'}
          </h2>
          {subject.department && (
            <span className="text-sm text-slate-500">{subject.department}</span>
          )}
          {subject.kind === 'new' && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              NEW
            </span>
          )}
        </div>

        {subject.kind === 'existing' ? (
          <ExistingSubjectChanges subject={subject} builder={builder} />
        ) : (
          <NewSubjectChanges subject={subject} builder={builder} />
        )}
      </div>
    ))}
  </div>
);

export default RequestChangesStep;
