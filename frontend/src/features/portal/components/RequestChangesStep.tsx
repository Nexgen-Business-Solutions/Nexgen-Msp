import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Laptop, Wrench } from 'lucide-react';
import type { RequestAction, RequestSubjectContext } from '@/lib/api/portal';
import Select from '@/shared/components/Select';
import ConfirmModal from '@/shared/components/ConfirmModal';
import { useNewUserRequestContext, useRequestSubjectContext, usePortalFilterOptions } from '../hooks/usePortal';
import { staleReason, type RequestSubject, type useRequestBuilder } from '../hooks/useRequestBuilder';
import { AvailableServiceRow, CurrentServiceRow } from './RequestServiceCard';

type Builder = ReturnType<typeof useRequestBuilder>;

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <div className="border-t border-slate-100">
    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
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

type MachineChoice = 'unspecified' | 'stock' | 'new';

const fieldClass =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100';

const fromSubject = (subject: RequestSubject) => ({
  deviceHostname: subject.machineHostname?.trim() || undefined,
  deviceSerial: subject.machineSerial?.trim() || undefined,
  deviceType: subject.machineType || undefined,
});

// left alone, the machine is one the technician prepares: that is the default, not a choice
const MACHINE_CHOICES: { value: MachineChoice; label: string }[] = [
  { value: 'stock', label: 'Existing device' },
  { value: 'new', label: 'A new machine' },
];

/**
 * Somebody with no machine can still be asked a machine service. Which machine it runs on is
 * the customer's to suggest — one of theirs, even one a colleague holds, or a new one — and
 * left unsaid, it is a machine the technician prepares. Suggesting a held machine only says
 * the customer wants it handed over: the technician carries the transfer out.
 */
const NoDeviceSection: React.FC<{
  subject: RequestSubject;
  builder: Builder;
  data: RequestSubjectContext;
}> = ({ subject, builder, data }) => {
  // kept on the person, so it survives moving on to somebody else and back
  const choice: MachineChoice = subject.machineChoice ?? 'unspecified';
  const stockDevice = subject.machineDevice ?? '';
  const [confirming, setConfirming] = useState<string | null>(null);

  const stock = data.assignable_devices ?? [];
  const options = usePortalFilterOptions();
  const offers = data.new_device_services ?? [];
  const machineIntents = builder.intentsOf(subject.key).filter((intent) => intent.isNewDevice);
  const picked = stock.find((device) => device.name === stockDevice);

  // what the customer said about the machine travels on every service asked for it
  const described = (device = picked, mode = choice) =>
    mode === 'stock' && device
      ? {
          deviceHostname: device.hostname,
          deviceSerial: device.serial_number ?? undefined,
          deviceType: device.device_type ?? undefined,
        }
      : mode === 'new'
        ? fromSubject(subject)
        : { deviceHostname: undefined, deviceSerial: undefined, deviceType: undefined };

  // what the customer typed about a new machine travels on every service asked for it
  const describeNew = (patch: Partial<RequestSubject>) => {
    builder.updateSubject(subject.key, patch);
    restamp(fromSubject({ ...subject, ...patch }));
  };

  const restamp = (patch: ReturnType<typeof described>) =>
    machineIntents.forEach((intent) => builder.updateIntent(intent.key, patch));

  // picking the chosen one again goes back to leaving it to the technician
  const choose = (option: MachineChoice) => {
    const mode = choice === option ? 'unspecified' : option;
    builder.updateSubject(subject.key, { machineChoice: mode });
    restamp(described(picked, mode));
  };

  const takeStock = (name: string) => {
    builder.updateSubject(subject.key, { machineDevice: name });
    restamp(described(stock.find((device) => device.name === name), 'stock'));
  };

  // a machine somebody holds is only suggested once the customer says they want it moved
  const pickStock = (name: string) => {
    const device = stock.find((row) => row.name === name);

    if (device?.assigned_client_user) setConfirming(name);
    else takeStock(name);
  };

  const pending = stock.find((device) => device.name === confirming);

  const add = (action: RequestAction, offer: { service_item: string; item_name: string }) =>
    builder.addIntent({
      subjectKey: subject.key,
      action: action.action_type,
      requestAction: action.name,
      actionLabel: action.title || action.action_type,
      serviceItem: offer.service_item,
      serviceLabel: offer.item_name,
      targetScope: 'Device',
      isNewDevice: true,
      ...described(),
    });

  // only what the customer needs to know: a machine somebody else holds is to be transferred
  const hint = choice === 'stock' && picked?.holder_name ? `Transfer from ${picked.holder_name}` : null;

  return (
    <Section title="Devices">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <Laptop size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">No device</p>
            {hint && <p className="text-xs text-amber-700">{hint}</p>}
          </div>
        </div>

        <div className="inline-flex shrink-0 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Device">
          {MACHINE_CHOICES.filter((row) => row.value !== 'stock' || stock.length > 0).map((row) => (
            <button
              key={row.value}
              type="button"
              role="radio"
              aria-checked={choice === row.value}
              onClick={() => choose(row.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                choice === row.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {row.label}
            </button>
          ))}
        </div>
      </div>

      {choice === 'stock' && (
        <div className="px-4 pb-3 sm:pl-16">
          <div className="max-w-md">
            <Select
              searchable
              className="w-full"
              value={stockDevice}
              onChange={pickStock}
              placeholder="Search a hostname or a serial"
              options={stock.map((device) => ({
                value: device.name,
                label: device.hostname,
                description: [
                  device.serial_number,
                  device.device_type,
                  device.holder_name ? `held by ${device.holder_name}` : 'in stock',
                ]
                  .filter(Boolean)
                  .join(' · '),
              }))}
            />
          </div>
        </div>
      )}

      {choice === 'new' && (
        <div className="grid gap-2 px-4 pb-3 sm:grid-cols-3 sm:pl-16">
          <input
            className={fieldClass}
            value={subject.machineSerial ?? ''}
            onChange={(event) => describeNew({ machineSerial: event.target.value })}
            placeholder="Serial Number"
            aria-label="Serial Number"
          />
          <input
            className={fieldClass}
            value={subject.machineHostname ?? ''}
            onChange={(event) => describeNew({ machineHostname: event.target.value })}
            placeholder="Hostname"
            aria-label="Hostname"
          />
          <Select
            className="w-full"
            value={subject.machineType ?? ''}
            onChange={(value) => describeNew({ machineType: value })}
            placeholder="Device Type"
            options={(options.data?.device_types ?? []).map((type) => ({ value: type, label: type }))}
          />
        </div>
      )}

      {offers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2">
          <span className="text-xs font-medium text-slate-500">Device services</span>
          {offers.map((offer) => {
            const asked = machineIntents.find((intent) => intent.serviceItem === offer.service_item);

            return (
              <AvailableServiceRow
                key={offer.service_item}
                offer={offer}
                asked={Boolean(asked)}
                onAdd={(action) => add(action, offer)}
                onUndo={() => asked && builder.removeIntent(asked.key)}
              />
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(pending)}
        title={`${pending?.hostname ?? ''} is held by ${pending?.holder_name ?? 'somebody else'}`}
        description={`Do you want it transferred to ${subject.fullName}? Nothing moves now: a technician carries out the transfer.`}
        confirmLabel="Confirm transfer"
        tone="warning"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) takeStock(confirming);
          setConfirming(null);
        }}
      />
    </Section>
  );
};

/** What can be asked for an existing person: what they hold, and what they could hold. */
const ExistingSubjectChanges: React.FC<{ subject: RequestSubject; builder: Builder }> = ({
  subject,
  builder,
}) => {
  const context = useRequestSubjectContext(subject.clientUser);

  const data = context.data;
  const subjectIntentKeys = builder.intentsOf(subject.key).map((intent) => intent.key);
  const stale = data
    ? builder
        .intentsOf(subject.key)
        .map((intent) => ({ intent, reason: staleReason(intent, data) }))
        .filter((row) => row.reason)
    : [];
  const subjectIntentSignature = subjectIntentKeys.join('|');
  const staleKeys = stale.map(({ intent }) => intent.key);
  const staleSignature = staleKeys.join('|');

  useEffect(() => {
    if (!data) return;
    builder.reportStaleIntents(subjectIntentKeys, staleKeys);
    // The signatures make this effect react to the contents, without re-running because
    // the arrays were rebuilt while rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder.reportStaleIntents, data, subjectIntentSignature, staleSignature]);

  if (context.isLoading) {
    return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (context.error || !data) {
    return (
      <p className="py-8 text-center text-sm text-red-600">
        {(context.error as Error)?.message || 'This person could not be read.'}
      </p>
    );
  }

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
  return (
    <div>
      {data.target_reason && (
        <div className="px-4 py-3">
          <Note>{data.target_reason}</Note>
        </div>
      )}

      {stale.length > 0 && (
        <div className="m-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
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

      <Section title="Personal services">
        {data.personal_services.current.length === 0 && (
          <p className="px-4 py-2 text-xs text-slate-500">No service yet</p>
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
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2">
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
        <NoDeviceSection subject={subject} builder={builder} data={data} />
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
              <p className="px-4 py-2 text-xs text-slate-500">
                <Laptop size={14} className="mr-1.5 inline text-slate-400" />
                No service yet
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
              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2">
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

/** For somebody who does not exist yet, every compatible catalogue service is on offer. */
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
    <div>
      <Section title="Personal services">
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

      <Section title="Device services">
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

/**
 * One person at a time: the people on the left, what to change for the chosen one on the
 * right, and the next one a click away once this one is done.
 */
const RequestChangesStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const subjects = builder.subjects;
  const index = Math.max(0, subjects.findIndex((row) => row.key === activeKey));
  const subject = subjects[index];

  if (!subject) return null;

  const previous = index > 0 ? subjects[index - 1] : undefined;
  const next = subjects[index + 1];
  const changes = (key: string) => builder.intentsOf(key).length;
  const nameOf = (row: { fullName?: string }) => row.fullName || 'New person';

  const go = (key: string) => {
    setActiveKey(key);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  const detail = (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 px-4 py-3">
        <h2 className="text-base font-bold text-slate-900">{subject.fullName || 'New person'}</h2>
        {subject.department && <span className="text-sm text-slate-500">{subject.department}</span>}
        {subject.kind === 'new' && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
            NEW
          </span>
        )}
      </div>

      {subject.kind === 'existing' ? (
        <ExistingSubjectChanges key={subject.key} subject={subject} builder={builder} />
      ) : (
        <NewSubjectChanges key={subject.key} subject={subject} builder={builder} />
      )}

      {subjects.length > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
          <button
            type="button"
            onClick={() => previous && go(previous.key)}
            disabled={!previous}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowLeft size={14} className="shrink-0" />
            Previous
          </button>

          <span className="shrink-0 text-xs font-medium text-slate-500">
            Person {index + 1} of {subjects.length}
          </span>

          <button
            type="button"
            onClick={() => next && go(next.key)}
            disabled={!next}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
          >
            Next
            <ArrowRight size={14} className="shrink-0" />
          </button>
        </div>
      )}
    </div>
  );

  const card = 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm';

  if (subjects.length === 1) return <div className={card}>{detail}</div>;

  // the people and the chosen one's changes are one card: the list is its left column
  return (
    <div className={`${card} lg:grid lg:grid-cols-[15rem_1fr]`}>
      <nav
        aria-label="People"
        className="space-y-1.5 border-b border-slate-100 bg-slate-50/60 p-2 lg:border-b-0 lg:border-r"
      >
        {subjects.map((row, position) => {
          const count = changes(row.key);
          const active = row.key === subject.key;

          return (
            <button
              key={row.key}
              type="button"
              onClick={() => go(row.key)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  count
                    ? 'bg-emerald-100 text-emerald-700'
                    : active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {count ? <Check size={12} /> : position + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{nameOf(row)}</span>
                <span className={`block text-xs ${count ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {count ? `${count} change${count > 1 ? 's' : ''}` : 'No change yet'}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {detail}
    </div>
  );
};

export default RequestChangesStep;
