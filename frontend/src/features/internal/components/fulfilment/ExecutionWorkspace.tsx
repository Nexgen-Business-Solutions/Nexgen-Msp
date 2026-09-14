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
import { requestKeys, useExecuteServiceActions, useRecordRequestActivity } from '../../hooks/useRequests';
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
  subjectCard,
  warnBar,
} from '../../lib/fulfilmentStyles';
import ApplyActionModal from './ApplyActionModal';
import ClientUserModal from './ClientUserModal';
import DeviceModal from './DeviceModal';
import PersonHeader from './PersonHeader';
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
const OPEN = ['Active', 'Suspended', 'Pending Removal'];
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
    ['Active', 'Suspended', 'Pending Removal'].includes(service.status)
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
  const [creating, setCreating] = useState<{ card: WorkCard; person: SubjectWorkGroup['person'] } | null>(null);
  const [preparing, setPreparing] = useState<{ card: WorkCard; group: SubjectWorkGroup } | null>(null);
  const [applying, setApplying] = useState<{
    card: WorkCard;
    person: SubjectWorkGroup['person'];
    action?: string;
  } | null>(null);
  const [acting, setActing] = useState<{
    kind: 'service' | 'device' | 'edit' | 'status' | 'stop' | 'deviceService' | 'repossess';
    key: string;
    machine?: PersonFacts['devices'][number];
    name: string;
    person: WorkPersonCard;
    facts: PersonFacts | null;
  } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const customerRequests = useCustomerRequests(plan.customer);
  const deviceOptions = useDeviceFilterOptions();

  // what was done straight on the person shows in the plan and the recap
  const refresh = () => {
    queryClient.invalidateQueries(requestKeys.plan(plan.request));
    queryClient.invalidateQueries(requestKeys.detail(plan.request));
  };
  const closeActing = () => {
    setActing(null);
    refresh();
  };

  const personActions = (group: SubjectWorkGroup, facts: PersonFacts | null): RowAction[] => {
    const person = group.person as WorkPersonCard;
    const open = (kind: NonNullable<typeof acting>['kind'], machine?: PersonFacts['devices'][number]) => () =>
      setActing({ kind, key: group.subject_key, name: person.full_name ?? person.name ?? 'Client User', person, facts, machine });
    const disabled = (person.lifecycle_status ?? facts?.lifecycle_status) === 'Disabled';
    const hasServices = (facts?.services ?? []).some(
      (service) => service.assignment_scope !== 'Device' && OPEN.includes(service.status)
    );

    return [
      { label: 'Add service', icon: Layers, onClick: open('service'), disabled },
      { label: 'Assign device', icon: Laptop, onClick: open('device'), disabled },
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
    ];
  };

  // the request says what the customer asked; the technician decides what is actually done
  const lineActions = (card: WorkCard, person: SubjectWorkGroup['person']): RowAction[] => {
    const status = card.current?.operational_status ?? '';
    const act = (action: string) => () => setApplying({ card, person, action });

    return [
      { label: 'Suspend', icon: PauseCircle, onClick: act('Suspend'), disabled: status !== 'Active' },
      { label: 'Resume', icon: PlayCircle, onClick: act('Resume'), disabled: status !== 'Suspended' },
      { label: 'Change', icon: PencilLine, onClick: act('Change'), disabled: !['Active', 'Suspended'].includes(status) },
      { label: 'Close', icon: CircleX, onClick: act('Remove'), danger: true, disabled: !OPEN.includes(status) },
    ].filter((row) => row.label !== (card.action === 'Remove' ? 'Close' : card.action));
  };

  const remaining = plan.groups.reduce(
    (count, group) =>
      count +
      [group.user_setup, ...group.devices.map((slot) => slot.work), ...group.services].filter(
        (card) => card && !settled(card)
      ).length,
    0
  );

  // the same ready act for several people, with nothing to type for any of them
  const groupable = useMemo(() => {
    const byAct = new Map<string, { label: string; cards: WorkCard[] }>();

    for (const group of plan.groups) {
      for (const card of group.services) {
        if (settled(card) || !card.ready || ['Blocked', 'Failed'].includes(card.status)) continue;
        if (identifierMissing(card, group.person)) continue;

        const key = `${card.service_item}|${card.action}`;
        const entry = byAct.get(key) ?? {
          label: `${card.action_label ?? card.action} · ${card.service_name ?? card.service_item ?? ''}`,
          cards: [],
        };
        entry.cards.push(card);
        byAct.set(key, entry);
      }
    }

    return [...byAct.values()].filter((entry) => entry.cards.length > 1);
  }, [plan.groups]);

  const runGroup = async (orders: string[]) => {
    setOutcome(null);
    try {
      const result = await groupRun.mutateAsync({ work_orders: orders });
      const refused = result.results.filter((row) => !row.ok);

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

  return (
    <div className="space-y-4">
      {/* <div className={banner}>
        <p className="font-semibold">Execution</p>
        <p className="mt-0.5">
          Complete the accepted work below. The ⋯ menus act on the person or the service directly
          when the real work differs from what was asked.
        </p>
      </div> */}

      {groupable.length > 0 && (
        <div className={bulkBar}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Grouped execution</p>
            <p className="text-xs text-slate-500">The same ready action across several people.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {groupable.map((entry) => (
              <button
                key={`${entry.cards[0].service_item}|${entry.cards[0].action}`}
                type="button"
                disabled={groupRun.isLoading}
                onClick={() => runGroup(entry.cards.map((card) => card.name))}
                className={btnPrimary}
              >
                {entry.label} for {entry.cards.length} people
              </button>
            ))}
          </div>
        </div>
      )}

      {outcome && (
        <p role="status" className={outcome.includes('failed') ? warnBar : `${warnBar} border-emerald-200 bg-emerald-50 text-emerald-900`}>
          {outcome}
        </p>
      )}

      {plan.groups.map((group) => {
        const person = group.person;
        const facts = person?.name ? people?.[person.name] ?? null : null;
        const userReady = Boolean(person?.name);
        const hasDeviceWork = group.services.some((card) => card.target_scope === 'Device');
        const deviceReady = group.devices.every((slot) => DONE.includes(slot.work.status));
        const requested = group.services.filter((card) => card.origin !== 'Technician');
        const added = group.services.filter((card) => card.origin === 'Technician');

        return (
          <div key={group.subject_key} className={subjectCard}>
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
                      {card.service_name ?? card.service_item} · {card.action_label ?? card.action}
                      {extra && <span className={`ml-2 ${pill('violet')}`}>Additional</span>}
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
                      {!done && card.ready && card.action !== 'Add' && lineActions(card, person).some((row) => !row.disabled) && (
                        <RowActionsMenu actions={lineActions(card, person)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {group.services.length === 0 && !group.user_setup && group.devices.length === 0 && (
              <p className="px-4 py-3 text-xs text-slate-500">
                No accepted request line remains for this person. The ⋯ menu still acts on them.
              </p>
            )}
          </div>
        );
      })}

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
              All accepted request lines and additional actions have been carried out.
            </p>
          </div>
          <button type="button" onClick={onContinue} className={btnPrimary}>
            Continue to Verify
          </button>
        </div>
      ) : (
        remaining > 0 && <p className="text-xs text-slate-500">{remaining} item{remaining > 1 ? 's' : ''} remaining.</p>
      )}

      <ClientUserModal card={creating?.card ?? null} person={creating?.person ?? null} onClose={() => setCreating(null)} />
      <DeviceModal
        card={preparing?.card ?? null}
        customer={plan.customer}
        person={preparing?.group.person ?? null}
        needs={preparing ? needsOf(preparing.group, preparing.card.device_requirement_key ?? '') : []}
        onClose={() => setPreparing(null)}
      />
      <ApplyActionModal
        card={applying?.card ?? null}
        person={applying?.person ?? null}
        action={applying?.action ?? null}
        onClose={() => setApplying(null)}
      />
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
