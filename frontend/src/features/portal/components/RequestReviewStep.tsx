import React from 'react';
import { Info, Laptop, Wrench } from 'lucide-react';
import { useRequestSubmissionContext } from '../hooks/usePortal';
import { isMachineOperation, type useRequestBuilder } from '../hooks/useRequestBuilder';

type Builder = ReturnType<typeof useRequestBuilder>;

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

/** The request as a person would read it back, grouped the way it was thought of. */
const GROUP_THRESHOLD = 12;

/** What a large request asks for, grouped by the selection it came from. */
const GroupedReview: React.FC<{ builder: Builder }> = ({ builder }) => {
  const groups = new Map<string, { label: string; people: Set<string>; keys: Set<string> }>();

  for (const subject of builder.subjects) {
    const label = subject.selectionLabel ?? subject.selectionOrigin ?? 'Individual';
    const group = groups.get(label) ?? { label, people: new Set(), keys: new Set() };
    group.people.add(subject.key);
    groups.set(label, group);
  }

  return (
    <div className="space-y-4">
      {[...groups.values()].map((group) => {
        const intents = builder.intents.filter((intent) => group.people.has(intent.subjectKey));
        const operations = [
          ...new Map(
            intents.map((intent) => [`${intent.operationCode}|${intent.serviceItem}`, intent])
          ).values(),
        ];

        return (
          <div key={group.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-bold text-slate-900">
              {group.label} · {group.people.size} people
            </p>

            {operations.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                Nothing is asked for these people yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {operations.map((intent) => {
                  const count = intents.filter(
                    (row) =>
                      row.operationCode === intent.operationCode &&
                      row.serviceItem === intent.serviceItem
                  ).length;

                  return (
                    <li
                      key={`${intent.operationCode}|${intent.serviceItem}`}
                      className="text-sm text-slate-700"
                    >
                      <span className="font-medium text-slate-900">
                        {intent.actionLabel} {intent.serviceLabel}
                      </span>
                      <span className="text-slate-500"> · {count} eligible people</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** The V3 reading: the snapshot, the grouped actions, and the shared context. */
const GroupedActionReview: React.FC<{ builder: Builder }> = ({ builder }) => {
  const submission = useRequestSubmissionContext();
  const departments = [
    ...new Set(builder.subjects.map((subject) => subject.department).filter(Boolean) as string[]),
  ];
  const fresh = builder.subjects.filter((subject) => subject.kind === 'new').length;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Review</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Confirm the exact snapshot and requested actions.
          </p>
        </div>

        <div className="grid gap-2 p-5 sm:grid-cols-3">
          {[
            [builder.subjects.length, 'People in snapshot'],
            [builder.actionGroups.length, 'Requested actions'],
            [builder.targetCount, 'Concrete targets'],
          ].map(([value, label]) => (
            <div key={label as string} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xl font-semibold text-slate-900">{value}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-700">
          People
        </p>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {departments.map((department) => (
            <span
              key={department}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
            >
              {department} ·{' '}
              {builder.subjects.filter((subject) => subject.department === department).length}
            </span>
          ))}
          {departments.length === 0 && (
            <span className="text-[11px] text-slate-500">No Department grouping</span>
          )}
        </div>

        {fresh > 0 && (
          <p className="border-t border-slate-100 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
            {fresh} new person(s) will require Client User preparation during fulfilment.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-700">
          Requested actions
        </p>
        <div className="divide-y divide-slate-100">
          {builder.actionGroups.map((group) => (
            <div key={group.groupKey} className="px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {group.operationLabelSnapshot}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {group.sourceScopeLabel} · {group.targets.length} target(s) from{' '}
                {group.selectedSubjectCount} selected people
              </p>
              <p className="mt-1 truncate text-[11px] text-slate-600">
                {group.targets
                  .map((target) => target.device_label ?? target.full_name)
                  .join(', ')}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-700">
          Details
        </p>
        <div className="space-y-1 px-4 py-3 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">Requested date:</span>{' '}
            {fmtDate(builder.defaultDate) || '—'}
          </p>
          <p>
            <span className="font-semibold text-slate-900">Priority:</span> {builder.priority}
          </p>
          <p className="whitespace-pre-line">
            <span className="font-semibold text-slate-900">Request note:</span>{' '}
            {builder.details.trim() || '—'}
          </p>
        </div>
      </section>

      <p className="text-xs text-slate-500">Submission records intent only.</p>

      {submission.data && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
          <div>
            <p className="text-sm font-semibold text-blue-900">After submission</p>
            <p className="mt-0.5 text-sm text-blue-800">{submission.data.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

const RequestReviewStep: React.FC<{ builder: Builder }> = ({ builder }) => {
  const submission = useRequestSubmissionContext();

  if (builder.actionGroups.length > 0) {
    return <GroupedActionReview builder={builder} />;
  }

  if (builder.subjects.length > GROUP_THRESHOLD) {
    return (
      <div className="space-y-4">
        <GroupedReview builder={builder} />

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Priority:</span> {builder.priority}
          </p>
          {builder.details.trim() && (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Details:</span>{' '}
              {builder.details.trim()}
            </p>
          )}
        </div>

        {submission.data && (
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
            <div>
              <p className="text-sm font-semibold text-blue-900">After submission</p>
              <p className="mt-0.5 text-sm text-blue-800">{submission.data.message}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {builder.subjects.map((subject) => {
        const intents = builder.intentsOf(subject.key);
        const machineActs = intents.filter((intent) => isMachineOperation(intent.operationCode));
        const services = intents.filter((intent) => !isMachineOperation(intent.operationCode));
        const personal = services.filter((intent) => !intent.managedDevice && !intent.isNewDevice);
        const onDevices = services.filter((intent) => intent.managedDevice);
        const toProvision = services.filter((intent) => intent.isNewDevice);

        return (
          <div key={subject.key} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-bold text-slate-900">
                {subject.fullName || 'New person'}
              </p>
              {subject.department && (
                <span className="text-xs text-slate-500">{subject.department}</span>
              )}
              {subject.kind === 'new' && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  NEW USER
                </span>
              )}
            </div>

            {intents.length === 0 && (
              <p className="mt-2 text-sm text-amber-700">Nothing is asked for this person yet.</p>
            )}

            {machineActs.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Device
                </p>
                <ul className="mt-1 space-y-1">
                  {machineActs.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <Laptop size={13} className="mr-1.5 inline text-slate-400" />
                      <span className="font-medium text-slate-900">{intent.actionLabel}</span>
                      {' · '}
                      {intent.deviceLabel}
                      {' · '}
                      {intent.currentHolderLabel || 'Unassigned'} →{' '}
                      {intent.requestedHolderLabel || 'Unassigned'}
                      {' from '}
                      {fmtDate(intent.requestedEffectiveDate || builder.defaultDate)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {personal.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Personal
                </p>
                <ul className="mt-1 space-y-1">
                  {personal.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{intent.serviceLabel}</span>
                      {' — '}
                      {intent.actionLabel} from{' '}
                      {fmtDate(intent.requestedEffectiveDate || builder.defaultDate)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {onDevices.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Devices
                </p>
                <ul className="mt-1 space-y-1">
                  {onDevices.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <Laptop size={13} className="mr-1.5 inline text-slate-400" />
                      <span className="font-medium text-slate-900">{intent.deviceLabel}</span>
                      {' · '}
                      {intent.serviceLabel} — {intent.actionLabel} from{' '}
                      {fmtDate(intent.requestedEffectiveDate || builder.defaultDate)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {toProvision.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Device required
                </p>
                <ul className="mt-1 space-y-1">
                  {toProvision.map((intent) => (
                    <li key={intent.key} className="text-sm text-slate-700">
                      <Wrench size={13} className="mr-1.5 inline text-slate-400" />
                      {intent.serviceLabel} —{' '}
                      {intent.machineSource === 'existing'
                        ? `on ${intent.deviceHostname ?? 'an existing device'}`
                        : intent.machineSource === 'new'
                          ? `on a new device${intent.deviceHostname ? ` (${intent.deviceHostname})` : ''}`
                          : 'device to be identified'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Priority:</span> {builder.priority}
        </p>
        {builder.details.trim() && (
          <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Details:</span> {builder.details.trim()}
          </p>
        )}
      </div>

      {submission.data && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-700" />
          <div>
            <p className="text-sm font-semibold text-blue-900">After submission</p>
            <p className="mt-0.5 text-sm text-blue-800">{submission.data.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestReviewStep;
