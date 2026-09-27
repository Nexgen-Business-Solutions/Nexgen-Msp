import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CircleX,
  Clock,
  Laptop,
  Layers,
  PauseCircle,
  PencilLine,
  Play,
  PlayCircle,
  Settings2,
  Undo2,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
} from 'lucide-react';
import RowActionsMenu, { type RowAction } from '@/shared/components/RowActionsMenu';
import type { ExecutionPlan, PersonFacts, SubjectWorkGroup, UserDetail, WorkCard, WorkPersonCard } from '@/lib/api/internal';
import {
  requestKeys,
  useExecuteServiceActions,
  useRecordRequestActivity,
  useSettleWorkDoneElsewhere,
} from '../../hooks/useRequests';
import { useCustomerRequests } from '../../hooks/useUsers';
import { useDeviceFilterOptions } from '../../hooks/useDevices';
import {
  btn,
  btnPrimary,
  bulkBar,
  identifierMissing,
  lineRow,
  nextBar,
  pill,
  warnBar,
} from '../../lib/fulfilmentStyles';
import ApplyActionModal from './ApplyActionModal';
import DeviceOperationModal from './DeviceOperationModal';
import MoreActionsModal from './MoreActionsModal';
import PrepareWorkModal from './PrepareWorkModal';
import RequiredIdentifiersModal from './RequiredIdentifiersModal';
import ClientUserModal from './ClientUserModal';
import PersonHeader from './PersonHeader';
import PeopleWorkspace from '@/shared/components/PeopleWorkspace';
import AddDeviceModal from '../AddDeviceModal';
import AddUserServiceModal from '../AddUserServiceModal';
import DeviceServiceModal from '../DeviceServiceModal';
import RepossessDeviceModal from '../RepossessDeviceModal';
import EditClientUserModal from '../EditClientUserModal';
import StopAllServicesModal from '../StopAllServicesModal';
import UserStatusModal from '../UserStatusModal';

type Props = {
  plan: ExecutionPlan;
  people?: Record<string, PersonFacts>;
  onContinue: () => void;
};

const DONE = ['Completed', 'Awaiting Verification'];
const OPEN = ['Active', 'Suspended'];
const settled = (card: WorkCard) => DONE.includes(card.status) || card.status === 'Cancelled';

const userRecord = (
  person: WorkPersonCard,
  facts: PersonFacts | null,
  customer: string
): UserDetail['user'] => ({
  name: person.name as string,
  full_name: person.full_name ?? facts?.full_name ?? person.name ?? 'Client User',
  department: person.department ?? facts?.department ?? null,
  customer,
  email: person.email ?? facts?.email ?? null,
  username: person.username ?? facts?.username ?? null,
  lifecycle_status: person.lifecycle_status ?? facts?.lifecycle_status ?? 'Active',
  start_date: facts?.start_date ?? null,
  disabled_date: facts?.disabled_date ?? null,
});

const userStatusDetail = (
  person: WorkPersonCard,
  facts: PersonFacts | null,
  customer: string
) => {
  const user = userRecord(person, facts, customer);
  const openServices = facts?.services.filter((service) =>
    ['Active', 'Suspended'].includes(service.status)
  ) ?? [];

  return {
    user,
    summary: {
      current_devices: facts?.devices.length ?? 0,
      active_personal_services: openServices.filter(
        (service) => service.assignment_scope !== 'Device'
      ).length,
      active_device_services: openServices.filter(
        (service) => service.assignment_scope === 'Device'
      ).length,
      open_requests: facts?.open_requests.length ?? 0,
      attention_count: 0,
    },
  } as UserDetail;
};

const LineIcon: React.FC<{ tone: 'done' | 'wait' | 'extra' | 'plain'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    aria-hidden
    className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
      {
        done: 'border-emerald-200 bg-emerald-50 text-emerald-600',
        wait: 'border-amber-200 bg-amber-50 text-amber-700',
        extra: 'border-violet-200 bg-violet-50 text-violet-700',
        plain: 'border-slate-200 bg-slate-50 text-slate-500',
      }[tone]
    }`}
  >
    {children}
  </span>
);

/**
 * Step 2: the accepted request first, then whatever else the job needs.
 *
 * Creating the person and preparing the machine sit on the lines that wait for them, so the
 * technician never has to go looking for why a line cannot run yet.
 */
const ExecutionWorkspace: React.FC<Props> = ({ plan, people, onContinue }) => {
  const groupRun = useExecuteServiceActions();
  const recordActivity = useRecordRequestActivity();
  const settleElsewhere = useSettleWorkDoneElsewhere();
  const [creating, setCreating] = useState<{ card: WorkCard; person: SubjectWorkGroup['person'] } | null>(null);
  const [preparing, setPreparing] = useState<{ card: WorkCard; group: SubjectWorkGroup } | null>(null);
  const [applying, setApplying] = useState<{
    card: WorkCard;
    person: SubjectWorkGroup['person'];
    operation?: string;
  } | null>(null);
  const [onMachine, setOnMachine] = useState<WorkCard | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [acting, setActing] = useState<{
    kind: 'service' | 'device' | 'edit' | 'status' | 'stop' | 'deviceService' | 'repossess';
    key: string;
    machine?: PersonFacts['devices'][number];
    name: string;
    person: WorkPersonCard;
    facts: PersonFacts | null;
  } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  // there is no draft to save here: every act is committed as it is carried out
  const [saved, setSaved] = useState(false);
  const [completing, setCompleting] = useState<'username' | 'serial_number' | null>(null);
  const [preparingWork, setPreparingWork] = useState<
    'device_resolution' | 'client_user_creation' | null
  >(null);

  // what the whole request is waiting on, gathered per record by the server
  const missing = {
    usernames: (plan.requirements ?? []).filter(
      (row) => row.kind === 'username' && !row.satisfied
    ).length,
    serials: (plan.requirements ?? []).filter(
      (row) => row.kind === 'serial_number' && !row.satisfied
    ).length,
    devices: (plan.requirements ?? []).filter(
      (row) => row.kind === 'device_resolution' && !row.satisfied
    ).length,
    people: (plan.requirements ?? []).filter(
      (row) => row.kind === 'client_user_creation' && !row.satisfied
    ).length,
  };
  const queryClient = useQueryClient();
  const customerRequests = useCustomerRequests(plan.customer);
  const deviceOptions = useDeviceFilterOptions();

  // what was done straight on the person shows in the plan and the recap
  const refresh = () => {
    queryClient.invalidateQueries(requestKeys.plan(plan.request));
    queryClient.invalidateQueries(requestKeys.detail(plan.request));
  };
  // the menu stays available whatever the request asks; a line it already did is settled
  const closeActing = () => {
    setActing(null);
    refresh();
    settleElsewhere.mutate(plan.request);
  };

  const personActions = (group: SubjectWorkGroup, facts: PersonFacts | null): RowAction[] => {
    const person = group.person as WorkPersonCard;
    const open = (kind: NonNullable<typeof acting>['kind'], machine?: PersonFacts['devices'][number]) => () =>
      setActing({ kind, key: group.subject_key, name: person.full_name ?? person.name ?? 'Client User', person, facts, machine });
    const disabled = (person.lifecycle_status ?? facts?.lifecycle_status) === 'Disabled';
    const hasServices = (facts?.services ?? []).some(
      (service) => service.assignment_scope !== 'Device' && OPEN.includes(service.status)
    );
    // a machine the request is still waiting for is given through its line, so the line is settled
    const slot = group.devices.find((row) => !settled(row.work) && row.work.ready);
    const assignDevice = slot ? () => setPreparing({ card: slot.work, group }) : open('device');

    return [
      { label: 'Add service', icon: Layers, onClick: open('service'), disabled },
      { label: 'Assign a device', icon: Laptop, onClick: assignDevice, disabled },
      ...(facts?.devices ?? []).flatMap((machine) => {
        const label = machine.hostname ?? machine.serial_number ?? machine.name;
        return [
          { label: `Add service on ${label}`, icon: Layers, onClick: open('deviceService', machine) },
          { label: `Return ${label} to stock`, icon: Undo2, onClick: open('repossess', machine), danger: true },
        ];
      }),
      { label: 'Edit', icon: PencilLine, onClick: open('edit') },
      disabled
        ? { label: 'Reactivate user', icon: UserCheck, onClick: open('status') }
        : { label: 'Disable user', icon: UserX, onClick: open('status'), danger: true },
      { label: 'Stop all services', icon: CircleX, onClick: open('stop'), danger: true, disabled: !hasServices },
      // what else the person, their machines and their services allow, read from the server
      { label: 'More actions', icon: Settings2, onClick: () => setMoreFor(group.subject_key) },
    ];
  };

  // the request says what the customer asked; the technician decides what is actually done
  const lineActions = (card: WorkCard, person: SubjectWorkGroup['person']): RowAction[] => {
    const status = card.current?.operational_status ?? '';
    const act = (operation: string) => () => setApplying({ card, person, operation });

    const offered: { code: string; action: RowAction }[] = [
      { code: 'service.suspend', action: { label: 'Suspend', icon: PauseCircle, onClick: act('service.suspend'), disabled: status !== 'Active' } },
      { code: 'service.resume', action: { label: 'Resume', icon: PlayCircle, onClick: act('service.resume'), disabled: status !== 'Suspended' } },
      { code: 'service.change', action: { label: 'Change service', icon: PencilLine, onClick: act('service.change'), disabled: !['Active', 'Suspended'].includes(status) } },
      { code: 'service.end', action: { label: 'Stop service', icon: CircleX, onClick: act('service.end'), danger: true, disabled: !OPEN.includes(status) } },
    ];

    return offered
      .filter((row) => row.code !== card.operation_code)
      .map((row) => row.action);
  };

  const remaining = plan.groups.reduce(
    (count, group) =>
      count +
      [
        group.user_setup,
        ...group.devices.map((slot) => slot.work),
        ...group.device_operations,
        ...group.services,
      ].filter((card) => card && !settled(card)).length,
    0
  );

  /**
   * The customer's own acts, and how much of each is ready to run now.
   *
   * The grouping is the one the request stored — the act the customer added — never one
   * rebuilt by matching service and action names. What is still missing information does
   * not hold back what is ready: the two are counted apart and only the ready ones run.
   */
  const groupable = useMemo(() => {
    const byAct = new Map<string, { label: string; cards: WorkCard[]; waiting: number }>();

    for (const group of plan.groups) {
      for (const card of group.services) {
        if (settled(card) || ['Blocked', 'Failed'].includes(card.status)) continue;

        const key =
          card.action_group_key ?? `legacy:${card.service_item}|${card.operation_code}`;
        const asked = plan.action_groups?.find((row) => row.group_key === card.action_group_key);
        const entry = byAct.get(key) ?? {
          label:
            asked?.label ??
            `${card.action_label ?? card.operation_code} · ${card.service_name ?? card.service_item ?? ''}`,
          cards: [],
          waiting: 0,
        };

        if (!card.ready || identifierMissing(card, group.person)) {
          entry.waiting += 1;
        } else {
          entry.cards.push(card);
        }

        byAct.set(key, entry);
      }
    }

    return [...byAct.values()].filter((entry) => entry.cards.length > 1 || entry.waiting > 0);
  }, [plan.groups, plan.action_groups]);

  const runGroup = async (orders: string[]) => {
    setOutcome(null);
    try {
      const result = await groupRun.mutateAsync({ work_orders: orders });
      const refused = result.results.filter((row) => !row.ok);

      if (result.completed) setSaved(true);

      setOutcome(
        refused.length
          ? `${result.completed} completed · ${refused.length} failed: ` +
              refused.map((row) => row.message).join('; ')
          : `${result.completed} completed`
      );
    } catch (error) {
      setOutcome((error as Error).message);
    }
  };

  const needsOf = (group: SubjectWorkGroup, key: string) =>
    group.services
      .filter((card) => card.device_requirement_key === key)
      .map((card) => card.service_name ?? card.service_item ?? '')
      .filter(Boolean);

  const executed = plan.stages.current !== 'execute';

  const workPeople = plan.groups.map((group) => {
    const open = [
      group.user_setup,
      ...group.devices.map((slot) => slot.work),
      ...group.device_operations,
      ...group.services,
    ].filter((card) => card && !settled(card)).length;
    return {
      key: group.subject_key,
      name: group.person?.full_name ?? 'Unnamed person',
      hint: open ? `${open} item${open > 1 ? 's' : ''} remaining` : 'Done',
      done: open === 0,
    };
  });

  return (
    <div className="space-y-4">
      {/* <div className={banner}>
        <p className="font-semibold">Execution</p>
        <p className="mt-0.5">
          Complete the accepted work below. The ⋯ menus act on the person or the service directly
          when the real work differs from what was asked.
        </p>
      </div> */}

      <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
        <Check size={13} />
        {saved ? 'Progress saved automatically' : 'Progress is saved as work is completed.'}
      </p>

      {(groupable.length > 0 ||
        missing.usernames > 0 ||
        missing.serials > 0 ||
        missing.devices > 0 ||
        missing.people > 0) && (
        <div className={bulkBar}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Action groups</p>
            <p className="text-xs text-slate-500">
              What the customer asked for, run together. Each target is still carried out on
              its own.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {groupable.map((entry) => (
              <div key={entry.label} className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-700">{entry.label}</span>
                {entry.waiting > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    {entry.waiting} need information
                  </span>
                )}
                {entry.cards.length > 0 && (
                  <button
                    type="button"
                    disabled={groupRun.isLoading}
                    onClick={() => runGroup(entry.cards.map((card) => card.name))}
                    className={btnPrimary}
                  >
                    Execute {entry.cards.length} ready
                  </button>
                )}
              </div>
            ))}
          </div>

          {missing.usernames > 0 && (
            <button
              type="button"
              onClick={() => setCompleting('username')}
              className={btn}
            >
              Complete {missing.usernames} usernames
            </button>
          )}

          {missing.serials > 0 && (
            <button type="button" onClick={() => setCompleting('serial_number')} className={btn}>
              Complete {missing.serials} serial numbers
            </button>
          )}

          {missing.devices > 0 && (
            <button type="button" onClick={() => setPreparingWork('device_resolution')} className={btn}>
              Prepare {missing.devices} Devices
            </button>
          )}

          {missing.people > 0 && (
            <button
              type="button"
              onClick={() => setPreparingWork('client_user_creation')}
              className={btn}
            >
              Create {missing.people} Client Users
            </button>
          )}
        </div>
      )}

      {preparingWork && (
        <PrepareWorkModal
          request={plan.request}
          customer={plan.customer}
          kind={preparingWork}
          requirements={plan.requirements ?? []}
          onClose={() => setPreparingWork(null)}
        />
      )}

      {completing && (
        <RequiredIdentifiersModal
          request={plan.request}
          kind={completing}
          requirements={plan.requirements ?? []}
          onClose={() => setCompleting(null)}
        />
      )}

      {outcome && (
        <p role="status" className={outcome.includes('failed') ? warnBar : `${warnBar} border-emerald-200 bg-emerald-50 text-emerald-900`}>
          {outcome}
        </p>
      )}

      <PeopleWorkspace people={workPeople}>
        {(key) => {
        const group = plan.groups.find((row) => row.subject_key === key) as SubjectWorkGroup;
        const person = group.person;
        const facts = person?.name ? people?.[person.name] ?? null : null;
        const userReady = Boolean(person?.name);
        const hasDeviceWork = group.services.some((card) => card.target_scope === 'Device');
        const deviceReady = group.devices.every((slot) => DONE.includes(slot.work.status));
        const requested = group.services.filter((card) => card.origin !== 'Technician');
        const added = group.services.filter((card) => card.origin === 'Technician');

        return (
          <div>
            <PersonHeader
              fullName={person?.full_name ?? 'Unnamed person'}
              isNew={!person?.name}
              facts={person?.name ? people?.[person.name] : null}
              asked={person}
            >
                <span className={pill(userReady ? 'ready' : 'pending')}>
                  {userReady ? 'Client user ready' : 'Client user required'}
                </span>
                {hasDeviceWork && (
                  <span className={pill(deviceReady ? 'ready' : 'pending')}>
                    {deviceReady ? 'Device ready' : 'Device required'}
                  </span>
                )}
                {userReady && person && <RowActionsMenu actions={personActions(group, facts)} />}
            </PersonHeader>

            {group.user_setup && (
              <div className={lineRow}>
                <LineIcon tone={settled(group.user_setup) ? 'done' : 'wait'}>
                  {settled(group.user_setup) ? <Check size={16} /> : <UserPlus size={16} />}
                </LineIcon>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {settled(group.user_setup) ? 'Client User created' : 'Client User'}
                  </p>
                  <p
                    className={`mt-1 text-xs font-semibold ${
                      settled(group.user_setup) ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {settled(group.user_setup)
                      ? group.user_setup.resulting_client_user
                      : 'Client User information required first'}
                  </p>
                </div>
                {!settled(group.user_setup) && (
                  <div className="col-start-2 flex gap-2 sm:col-start-auto">
                    <button
                      type="button"
                      onClick={() => setCreating({ card: group.user_setup as WorkCard, person })}
                      className={btn}
                    >
                      Create Client User
                    </button>
                  </div>
                )}
              </div>
            )}

            {group.devices.map((slot) => {
              const done = settled(slot.work);

              return (
                <div key={slot.device_requirement_key} className={lineRow}>
                  <LineIcon tone={done ? 'done' : 'wait'}>
                    {done ? <Check size={16} /> : <Laptop size={16} />}
                  </LineIcon>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {done ? 'Device prepared' : 'Device'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {done
                        ? [slot.work.device?.hostname, slot.work.device?.serial_number].filter(Boolean).join(' · ')
                        : `Needed by ${needsOf(group, slot.device_requirement_key).join(', ') || 'device services'}`}
                    </p>
                    {!done && (
                      <p className="mt-1 text-xs font-semibold text-amber-700">
                        {slot.work.ready ? 'Device information required first' : `Waiting for ${slot.work.waiting_on}`}
                      </p>
                    )}
                  </div>
                  {!done && slot.work.ready && (
                    <div className="col-start-2 flex gap-2 sm:col-start-auto">
                      <button type="button" onClick={() => setPreparing({ card: slot.work, group })} className={btn}>
                        Prepare Device
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {group.device_operations.map((card) => {
              const done = settled(card);
              const heldUp = ['Blocked', 'Failed'].includes(card.status);
              // before it runs: who holds it and who was asked for; after: what actually happened
              const from = (done ? card.snapshot_holder_name : card.current_holder_name) ?? 'Unassigned';
              const to =
                (done ? card.device?.holder_name : card.requested_holder_name) ?? 'Unassigned';

              return (
                <div
                  key={card.name}
                  className={`${lineRow} ${done ? 'bg-emerald-50/30' : 'bg-white'}`}
                >
                  <LineIcon tone={done ? 'done' : card.ready ? 'plain' : 'wait'}>
                    {done ? <Check size={16} /> : <Laptop size={16} />}
                  </LineIcon>

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {card.action_label ?? card.operation_code}
                      {card.origin === 'Technician' && (
                        <span className={`ml-2 ${pill('violet')}`}>ADDITIONAL ACTION</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-700">{card.device?.hostname}</p>
                    <p className="text-sm text-slate-700">
                      {from} → {to}
                    </p>
                    {card.override_reason && (
                      <p className="mt-0.5 text-xs text-violet-700">
                        Requested: {card.requested_holder_name} · {card.override_reason}
                      </p>
                    )}
                    {!done && card.holder_changed && (
                      <p className="mt-0.5 text-xs font-semibold text-amber-700">
                        The Device holder changed after this request was submitted. Review the
                        current holder before continuing.
                      </p>
                    )}
                    <p
                      className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
                        done
                          ? 'text-emerald-700'
                          : heldUp
                            ? 'text-orange-700'
                            : card.ready
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                      }`}
                    >
                      {done
                        ? card.status === 'Cancelled'
                          ? 'Given up'
                          : 'Completed'
                        : heldUp
                          ? `${card.status}${card.failure_reason ? ` · ${card.failure_reason}` : ''}`
                          : card.ready
                            ? 'Ready to execute'
                            : `Waiting for ${card.waiting_on}`}
                    </p>
                  </div>

                  {!done && card.ready && !heldUp && (
                    <div className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                      <button type="button" onClick={() => setOnMachine(card)} className={btnPrimary}>
                        <Play size={13} />
                        {card.action_label ?? 'Carry it out'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {[...requested, ...added].map((card) => {
              const done = settled(card);
              const extra = card.origin === 'Technician';
              const heldUp = ['Blocked', 'Failed'].includes(card.status);

              return (
                <div
                  key={card.name}
                  className={`${lineRow} ${done ? 'bg-emerald-50/30' : extra ? 'bg-violet-50/20' : 'bg-white'}`}
                >
                  <LineIcon tone={done ? 'done' : extra ? 'extra' : card.ready ? 'plain' : 'wait'}>
                    {done ? (
                      <Check size={16} />
                    ) : card.target_scope === 'Device' ? (
                      <Laptop size={16} />
                    ) : extra ? (
                      <Settings2 size={16} />
                    ) : (
                      <UserRound size={16} />
                    )}
                  </LineIcon>

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {card.action_label ?? card.action} · {card.service_name ?? card.service_item}
                      {extra ? (
                        <span className={`ml-2 ${pill('violet')}`}>ADDITIONAL ACTION</span>
                      ) : (
                        <span className={`ml-2 ${pill('blue')}`}>REQUESTED</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {card.target_scope} scope
                      {card.target_scope === 'Device' && card.device?.hostname ? ` · ${card.device.hostname}` : ''}
                      {card.current ? ` · currently ${card.current.operational_status.toLowerCase()}` : ''}
                    </p>
                    {extra && card.technician_reason && (
                      <p className="mt-0.5 text-xs text-violet-700">{card.technician_reason}</p>
                    )}
                    <p
                      className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
                        done
                          ? 'text-emerald-700'
                          : heldUp
                            ? 'text-orange-700'
                            : card.ready
                              ? extra
                                ? 'text-violet-700'
                                : 'text-emerald-700'
                              : 'text-amber-700'
                      }`}
                    >
                      {done ? (
                        card.status === 'Cancelled' ? 'Given up' : 'Completed'
                      ) : heldUp ? (
                        `${card.status}${card.failure_reason ? ` · ${card.failure_reason}` : ''}`
                      ) : card.ready ? (
                        extra ? 'Additional service action · ready' : 'Ready to execute'
                      ) : (
                        <>
                          <Clock size={12} />
                          Waiting for {card.waiting_on}
                        </>
                      )}
                    </p>
                  </div>

                  {(!done || plan.status !== 'Completed') && (
                    <div className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                      {!done && card.ready && !heldUp && (
                        <button type="button" onClick={() => setApplying({ card, person })} className={btnPrimary}>
                          <Play size={13} />
                          {card.action_label ?? card.action}
                        </button>
                      )}
                      {!done && card.ready && card.operation_code !== 'service.add' && lineActions(card, person).some((row) => !row.disabled) && (
                        <RowActionsMenu actions={lineActions(card, person)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {group.services.length === 0 &&
              !group.user_setup &&
              group.devices.length === 0 &&
              group.device_operations.length === 0 && (
              <p className="px-4 py-3 text-xs text-slate-500">
                No accepted request line remains for this person. The ⋯ menu still acts on them.
              </p>
            )}
          </div>
        );
        }}
      </PeopleWorkspace>

      {plan.rejected.length > 0 && (
        <p className="text-xs text-slate-500">
          {plan.rejected.length} rejected line{plan.rejected.length > 1 ? 's are' : ' is'} not part of
          the work.
        </p>
      )}

      {executed && plan.status !== 'Completed' ? (
        <div className={nextBar}>
          <div>
            <p className="text-sm font-semibold text-emerald-800">Execution complete</p>
            <p className="text-xs text-emerald-700">
              All accepted request work and additional technician actions have been resolved.
            </p>
          </div>
          <button type="button" onClick={onContinue} className={btnPrimary}>
            Continue to Verify
          </button>
        </div>
      ) : (
        remaining > 0 && <p className="text-xs text-slate-500">{remaining} item{remaining > 1 ? 's' : ''} remaining.</p>
      )}

      <ClientUserModal
        card={creating?.card ?? null}
        person={creating?.person ?? null}
        customer={plan.customer}
        onClose={() => setCreating(null)}
      />
      <AddDeviceModal
        open={Boolean(preparing)}
        clientUser={(preparing?.group.person?.name as string) ?? ''}
        userName={preparing?.group.person?.full_name ?? 'this person'}
        customer={plan.customer}
        deviceTypes={deviceOptions.data?.device_types ?? []}
        interfaceTypes={deviceOptions.data?.interface_types ?? []}
        requests={[]}
        workOrder={preparing?.card.name ?? null}
        needs={preparing ? needsOf(preparing.group, preparing.card.device_requirement_key ?? '') : []}
        initial={{
          hostname: preparing?.card.asked_hostname,
          serial_number: preparing?.card.asked_serial,
          device_type: preparing?.card.asked_device_type,
        }}
        onClose={() => setPreparing(null)}
      />
      <ApplyActionModal
        card={applying?.card ?? null}
        person={applying?.person ?? null}
        operation={applying?.operation ?? null}
        onClose={() => setApplying(null)}
      />
      <DeviceOperationModal
        card={onMachine}
        customer={plan.customer}
        onClose={() => setOnMachine(null)}
      />
      {moreFor && (
        <MoreActionsModal
          request={plan.request}
          subjectKey={moreFor}
          onClose={() => setMoreFor(null)}
        />
      )}
      {acting && (
        <>
          <AddUserServiceModal
            open={acting.kind === 'service'}
            user={userRecord(acting.person, acting.facts, plan.customer)}
            requests={customerRequests.data ?? []}
            defaultRequest={plan.request}
            onClose={closeActing}
          />
          <AddDeviceModal
            open={acting.kind === 'device'}
            clientUser={acting.person.name as string}
            userName={acting.name}
            customer={plan.customer}
            deviceTypes={deviceOptions.data?.device_types ?? []}
            interfaceTypes={deviceOptions.data?.interface_types ?? []}
            requests={customerRequests.data ?? []}
            defaultRequest={plan.request}
            onClose={closeActing}
          />
          <EditClientUserModal
            open={acting.kind === 'edit'}
            user={userRecord(acting.person, acting.facts, plan.customer)}
            onClose={closeActing}
            onDone={() =>
              recordActivity.mutate({
                name: plan.request,
                subject_key: acting.key,
                label: 'User information updated',
                detail: `${acting.name}'s information was updated.`,
              })
            }
          />
          <UserStatusModal
            open={acting.kind === 'status'}
            detail={userStatusDetail(acting.person, acting.facts, plan.customer)}
            onClose={closeActing}
            onDone={(activity) =>
              recordActivity.mutate({
                name: plan.request,
                subject_key: acting.key,
                label: activity.label,
                detail: activity.detail,
              })
            }
          />
          <DeviceServiceModal
            device={acting.kind === 'deviceService' ? acting.machine?.name ?? null : null}
            defaultRequest={plan.request}
            onClose={closeActing}
          />
          <RepossessDeviceModal
            open={acting.kind === 'repossess'}
            device={acting.machine?.name ?? ''}
            hostname={acting.machine?.hostname ?? ''}
            serialNumber={acting.machine?.serial_number}
            currentHolder={acting.person.name}
            currentHolderName={acting.name}
            onClose={closeActing}
          />
          <StopAllServicesModal
            person={acting.kind === 'stop' ? { name: acting.person.name as string, full_name: acting.name } : null}
            sourceRequest={plan.request}
            onClose={closeActing}
          />
        </>
      )}
    </div>
  );
};

export default ExecutionWorkspace;
